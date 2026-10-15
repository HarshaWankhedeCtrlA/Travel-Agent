// Pre-trip reminders — PRD §11 flow F8
//   - 7 days before departure: full reminder (flight, hotel, weather, packing, docs)
//   - 1 day before departure: "tomorrow" reminder (flight time, check-in, alarm)
//
// Design:
//   - Reminder text is localized (en / hinglish / hi)
//   - Rules are deterministic code (LLM never writes reminders)
//   - Idempotent: trip.remindersSent[] tracks what's already sent
//   - Respects: opt-out, paused, quiet hours

import Trip from "../models/trip.js";
import Traveler from "../models/traveler.js";
import Message from "../models/message.js";
import * as wa from "../providers/whatsapp.js";

// ── Rules ────────────────────────────────────────────────────

const REMINDER_DAYS = { "7d": 7, "1d": 1 };

// How many days until the trip departs?
export function daysToDeparture(departDate) {
  if (!departDate) return null;
  const ms = new Date(departDate).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

// Which reminders are due for this trip, right now?
export function dueReminders(trip) {
  const days = daysToDeparture(trip.brief?.departDate);
  if (days === null || days < 0) return [];   // past trip or no date

  const sent = trip.remindersSent || [];
  const due = [];
  for (const [key, targetDays] of Object.entries(REMINDER_DAYS)) {
    // Fire when within `targetDays` but not too early:
    //   7d reminder: days <= 7 and days > 1
    //   1d reminder: days <= 1 and days >= 0
    if (key === "7d" && days <= 7 && days > 1 && !sent.includes("7d")) due.push("7d");
    if (key === "1d" && days <= 1 && days >= 0 && !sent.includes("1d")) due.push("1d");
  }
  return due;
}

function isQuietHours() {
  const h = new Date().getHours();
  return h >= 22 || h < 8;
}

// ── Orchestration ────────────────────────────────────────────

// Called by the scheduler for one trip. Returns { sent: [...], skipped: "..." }
export async function runRemindersForTrip(tripId) {
  const trip = await Trip.findById(tripId).populate("travelerId");
  if (!trip) return { skipped: "trip not found" };
  if (trip.paused) return { skipped: "trip paused" };
  if (trip.travelerId?.optedOut) return { skipped: "traveler opted out" };

  const due = dueReminders(trip);
  if (due.length === 0) return { skipped: "no reminder due" };

  if (isQuietHours()) return { skipped: "quiet hours" };

  const lang = trip.travelerId?.language || "en";
  const sentNow = [];

  for (const key of due) {
    const text = formatReminder(key, trip, lang);
    if (!text) continue;

    await wa.sendText(trip.travelerId.phone, text);
    await Message.create({
      travelerId: trip.travelerId._id,
      tripId: trip._id,
      direction: "out",
      body: text,
    });

    if (!trip.remindersSent) trip.remindersSent = [];
    trip.remindersSent.push(key);
    sentNow.push(key);
  }

  if (sentNow.length) {
    trip.markModified("remindersSent");
    await trip.save();
  }

  return { sent: sentNow };
}

// ── Message formatting ───────────────────────────────────────

function packLine(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items.join(", ");
}

function formatReminder(key, trip, lang) {
  const b = trip.brief || {};
  const pkg = (trip.packages || []).find((p) => p.tier === trip.chosenTier) || trip.packages?.[0];
  const itin = trip.itinerary || {};

  const dest = b.destination || "your destination";
  const origin = b.origin || "";
  const departDate = b.departDate || "";
  const flight = pkg?.flight || {};
  const hotel = pkg?.hotel || {};

  const flightLine =
    flight.airline && flight.flightNumber
      ? `${flight.airline} ${flight.flightNumber}`
      : "your flight";

  const hotelLine = hotel.name || "your hotel";

  const weather = itin.weather || "";
  const packing = packLine(itin.packing);
  const documents = packLine(itin.documents);

  if (key === "7d") {
    if (lang === "hi") {
      return (
        `📅 आपका ${dest} trip 7 दिन में है!\n\n` +
        `✈️ ${flightLine}${departDate ? ` — ${departDate}` : ""}\n` +
        `🏨 ${hotelLine}\n` +
        (weather ? `🌡️ ${weather}\n` : "") +
        (packing ? `📋 Packing: ${packing}\n` : "") +
        (documents ? `📄 Documents: ${documents}\n` : "") +
        `\nकुछ बदलना है? बस reply करें।`
      );
    }
    if (lang === "hinglish") {
      return (
        `📅 Aapka ${dest} trip 7 din mein hai!\n\n` +
        `✈️ ${flightLine}${departDate ? ` — ${departDate}` : ""}\n` +
        `🏨 ${hotelLine}\n` +
        (weather ? `🌡️ ${weather}\n` : "") +
        (packing ? `📋 Packing: ${packing}\n` : "") +
        (documents ? `📄 Documents: ${documents}\n` : "") +
        `\nKuch change karna hai? Bas reply karo.`
      );
    }
    return (
      `📅 Your ${dest} trip is in 7 days!\n\n` +
      `✈️ ${flightLine}${departDate ? ` — ${departDate}` : ""}\n` +
      `🏨 ${hotelLine}\n` +
      (weather ? `🌡️ ${weather}\n` : "") +
      (packing ? `📋 Packing: ${packing}\n` : "") +
      (documents ? `📄 Documents: ${documents}\n` : "") +
      `\nNeed to change anything? Just reply.`
    );
  }

  if (key === "1d") {
    if (lang === "hi") {
      return (
        `✈️ कल आपका ${dest} trip है!\n\n` +
        `Flight: ${flightLine}${origin ? ` — ${origin} से` : ""}\n` +
        `Hotel: ${hotelLine}\n\n` +
        `Don't forget:\n` +
        `• Web check-in (48h पहले खुलता है)\n` +
        `• Airport cab book करें\n` +
        `• Alarm set करें\n\n` +
        `Safe travels! 🎉`
      );
    }
    if (lang === "hinglish") {
      return (
        `✈️ Kal aapka ${dest} trip hai!\n\n` +
        `Flight: ${flightLine}${origin ? ` — ${origin} se` : ""}\n` +
        `Hotel: ${hotelLine}\n\n` +
        `Don't forget:\n` +
        `• Web check-in (48h pehle khulta hai)\n` +
        `• Airport cab book karo\n` +
        `• Alarm set karo\n\n` +
        `Safe travels! 🎉`
      );
    }
    return (
      `✈️ Tomorrow! Your ${dest} trip is here.\n\n` +
      `Flight: ${flightLine}${origin ? ` — from ${origin}` : ""}\n` +
      `Hotel: ${hotelLine}\n\n` +
      `Don't forget:\n` +
      `• Web check-in (opens 48h before)\n` +
      `• Airport cab booked\n` +
      `• Alarm set\n\n` +
      `Safe travels! 🎉`
    );
  }

  return null;
}