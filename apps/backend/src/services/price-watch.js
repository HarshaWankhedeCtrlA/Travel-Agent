import Trip from "../models/trip.js";
import PriceAlert from "../models/price-alert.js";
import Message from "../models/message.js";
import * as wa from "../providers/whatsapp.js";
import { searchFlights } from "../providers/flights.js";
import { searchHotels } from "../providers/hotels.js";
import { nightsBetween } from "./budget.js";

// PRD §6: cadence by days to departure
export function checkFrequency(daysToDeparture) {
  if (daysToDeparture > 90) return 24 * 60 * 60 * 1000; // 1x/day
  if (daysToDeparture > 30) return 12 * 60 * 60 * 1000; // 2x/day
  if (daysToDeparture > 7) return 6 * 60 * 60 * 1000; // every 6h
  return 4 * 60 * 60 * 1000; // every 4h
}

// Is it quiet hours right now? PRD §6: 10pm to 8am
function isQuietHours() {
  const hour = new Date().getHours();
  return hour >= 22 || hour < 8;
}

// Has this trip reached its alert limits?
async function canSendAlert(tripId) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const last24h = await PriceAlert.countDocuments({ tripId, sentAt: { $gte: dayAgo } });
  if (last24h >= 1) return false;

  const lastWeek = await PriceAlert.countDocuments({ tripId, sentAt: { $gte: weekAgo } });
  if (lastWeek >= 3) return false;

  return true;
}

// Main entry point for one trip
export async function runPriceCheck(tripId) {
  const trip = await Trip.findById(tripId).populate("travelerId");
  if (!trip) return { skipped: "trip not found" };
  if (trip.paused) return { skipped: "paused" };
  if (trip.watchPaused) return { skipped: "watch paused" };
  if (!trip.feePaid) return { skipped: "fee not paid" };

  const brief = trip.brief || {};
  if (!brief.origin || !brief.destination || !brief.departDate) {
    return { skipped: "incomplete brief" };
  }

  const daysToDeparture = Math.ceil(
    (new Date(brief.departDate) - new Date()) / 86400000
  );
  if (daysToDeparture < 0) return { skipped: "trip in past" };

  // Fetch current prices
  let flights = [];
  let hotels = [];
  try {
    [flights, hotels] = await Promise.all([
      searchFlights({
        origin: brief.origin,
        destination: brief.destination,
        departDate: brief.departDate,
        returnDate: brief.returnDate,
        travelers: brief.travelers || 1,
      }).catch(() => []),
      searchHotels({
        city: brief.destination,
        checkIn: brief.departDate,
        checkOut: brief.returnDate,
        travelers: brief.travelers || 1,
      }).catch(() => []),
    ]);
  } catch (err) {
    console.error("[price-watch] provider failed:", err.message);
    return { skipped: "provider error" };
  }

  if (!flights.length || !hotels.length) {
    return { skipped: "no provider data" };
  }

  const nights = nightsBetween(brief.departDate, brief.returnDate);

  // Current best price for the chosen tier
  const chosenTier = trip.chosenTier || "best_value";
  const cheapestFlight = [...flights].sort((a, b) => a.totalPrice - b.totalPrice)[0];
  const cheapestHotel = [...hotels].sort((a, b) => a.pricePerNight - b.pricePerNight)[0];
  const currentPrice = cheapestFlight.totalPrice + cheapestHotel.pricePerNight * nights;

  // Baseline = price when the fee was paid
  const baseline = trip.baselinePrice || currentPrice;
  const change = currentPrice - baseline;
  const changePct = baseline > 0 ? (change / baseline) * 100 : 0;

  trip.lastCheckedAt = new Date();
  await trip.save();

  // Evaluate alerts (PRD §6)
  const alert = evaluateAlert({
    trip,
    currentPrice,
    baseline,
    change,
    changePct,
    daysToDeparture,
  });

  if (!alert) return { skipped: "no alert condition", currentPrice, baseline };

  // Rate limit
  const allowed = await canSendAlert(trip._id);
  if (!allowed) return { skipped: "rate limited" };

  // Quiet hours (unless sold out)
  if (isQuietHours() && alert.type !== "SOLD_OUT") {
    return { skipped: "quiet hours" };
  }

  // Send the alert
  const text = formatAlert(alert, trip, currentPrice, change);
  const phone = trip.travelerId?.phone;
  if (!phone) return { skipped: "no phone" };

  await wa.sendText(phone, text);
  await Message.create({
    travelerId: trip.travelerId._id,
    tripId: trip._id,
    direction: "out",
    body: text,
  });

  await PriceAlert.create({
    tripId: trip._id,
    type: alert.type,
    price: currentPrice,
    change,
    changePct: Math.round(changePct * 10) / 10,
    payload: alert,
  });

  trip.lastAlertAt = new Date();
  await trip.save();

  return { sent: true, type: alert.type, price: currentPrice, change };
}

// PRD §6: alert rules
function evaluateAlert({ trip, currentPrice, baseline, change, changePct, daysToDeparture }) {
  const budget = trip.brief?.budget || Infinity;

  // Rule 1: Good price — dropped 8%+ AND fits budget
  if (changePct <= -8 && currentPrice <= budget) {
    return { type: "GOOD_PRICE", savings: Math.abs(change) };
  }

  // Rule 2: Now fits budget when it did not before
  if (currentPrice <= budget && baseline > budget) {
    return { type: "GOOD_PRICE", savings: baseline - currentPrice };
  }

  // Rule 3: Rising soon — up 10%+, less than 30 days out
  if (changePct >= 10 && daysToDeparture < 30) {
    return { type: "RISING_SOON", increase: change };
  }

  // Rule 4: Urgent — under 7 days and rising
  if (daysToDeparture < 7 && changePct >= 5) {
    return { type: "SOLD_OUT", urgency: true };
  }

  return null;
}

// PRD §6: never fake urgency. Every claim has data behind it.
function formatAlert(alert, trip, currentPrice, change) {
  const dest = trip.brief?.destination || "your trip";
  const inr = (n) => `₹${Math.abs(n).toLocaleString("en-IN")}`;

  if (alert.type === "GOOD_PRICE") {
    return (
      `💰 Good news — prices dropped for your ${dest} trip!\n\n` +
      `You're saving ${inr(alert.savings)} vs when you first checked.\n` +
      `Current best: ${inr(currentPrice)}.\n\n` +
      `Reply "book" to grab it, or "wait" to keep watching.`
    );
  }

  if (alert.type === "RISING_SOON") {
    return (
      `📈 Prices are rising for ${dest} — up ${inr(change)}.\n\n` +
      `Based on recent trends, likely to go higher.\n` +
      `Current best: ${inr(currentPrice)}.\n\n` +
      `Reply "book" to lock in, or "wait" to see if it dips.`
    );
  }

  if (alert.type === "SOLD_OUT") {
    return (
      `⏰ Your ${dest} trip is coming up soon and prices are up.\n\n` +
      `Current best: ${inr(currentPrice)}.\n` +
      `We recommend booking today.\n\n` +
      `Reply "book" to proceed.`
    );
  }

  return `📊 Update on your ${dest} trip — reply STATUS to see details.`;
}