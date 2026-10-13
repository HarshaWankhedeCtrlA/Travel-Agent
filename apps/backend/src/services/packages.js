import { searchFlights, scoreFlight } from "../providers/flights.js";
import { searchHotels, scoreHotel } from "../providers/hotels.js";
import { splitBudget, nightsBetween } from "./budget.js";

// A hotel rating is trusted only with enough reviews behind it.
const MIN_REVIEWS = 20;
const MIN_RATING = 3.5;
// Longer links break when a message is split, so they get a short fallback.
const MAX_LINK_LEN = 500;

const byPrice = (a, b) => a.pricePerNight - b.pricePerNight;
const byComfortHotel = (a, b) =>
  (b.guestRating ?? 0) - (a.guestRating ?? 0) ||
  (b.reviewCount || 0) - (a.reviewCount || 0) ||
  (b.starRating ?? 0) - (a.starRating ?? 0);
// Lower is more comfortable: fewer stops, not often late, shorter
const comfortRank = (f) => f.stops * 10000 + (f.oftenDelayed ? 5000 : 0) + f.durationMinutes;
const byComfortFlight = (a, b) => comfortRank(a) - comfortRank(b) || a.totalPrice - b.totalPrice;

export async function buildPackages(trip) {
  const brief = trip.brief;
  const travelers = brief.travelers || 1;
  const nights = nightsBetween(brief.departDate, brief.returnDate);

  const budget = splitBudget(brief.budget, nights, travelers);

  const [flights, hotels] = await Promise.all([
    searchFlights({
      origin: brief.origin,
      destination: brief.destination,
      departDate: brief.departDate,
      returnDate: brief.returnDate,
      travelers,
    }),
    searchHotels({
      city: brief.destination,
      checkIn: brief.departDate,
      checkOut: brief.returnDate,
      travelers,
    }),
  ]);

  if (flights.length === 0) {
    throw new Error(
      `No flights found from ${brief.origin} to ${brief.destination} on ${brief.departDate}. Try a nearby major city.`
    );
  }
  if (hotels.length === 0) {
    throw new Error("No hotels found for this destination");
  }

  // Hotels with a rating we can trust. If fewer than 3 qualify, use them all.
  const trusted = hotels.filter(
    (h) => h.guestRating != null && h.guestRating >= MIN_RATING && (h.reviewCount || 0) >= MIN_REVIEWS
  );
  const pool = trusted.length >= 3 ? trusted : hotels;

  const cheapFlight = [...flights].sort((a, b) => a.totalPrice - b.totalPrice)[0];
  const cheapHotel = [...pool].sort(byPrice)[0];

  const bestFlight = [...flights].sort((a, b) => scoreFlight(a) - scoreFlight(b))[0];
  const bestHotel =
    [...pool]
      .filter((h) => h.id !== cheapHotel.id) // distinct from cheapest
      .sort((a, b) => scoreHotel(b, nights) - scoreHotel(a, nights))[0] ||
    [...pool].sort((a, b) => scoreHotel(b, nights) - scoreHotel(a, nights))[0];

  const comfFlight =
    [...flights].filter((f) => f.id !== cheapFlight.id && f.id !== bestFlight.id).sort(byComfortFlight)[0] ||
    [...flights].filter((f) => f.id !== cheapFlight.id).sort(byComfortFlight)[0] ||
    [...flights].sort(byComfortFlight)[0];

  const comfHotel =
    [...pool].filter((h) => h.id !== cheapHotel.id && h.id !== bestHotel.id).sort(byComfortHotel)[0] ||
    [...pool].filter((h) => h.id !== cheapHotel.id).sort(byComfortHotel)[0] ||
    [...pool].sort(byComfortHotel)[0];

  const tiers = [
    {
      tier: "cheapest",
      label: "💰 Cheapest",
      flight: cheapFlight,
      hotel: cheapHotel,
      nights,
      reasoning: "Lowest total price across flights and stay",
    },
    {
      tier: "best_value",
      label: "⭐ Best value",
      flight: bestFlight,
      hotel: bestHotel,
      nights,
      reasoning: "Best mix of price, guest rating and location",
    },
    {
      tier: "comfortable",
      label: "👑 Most comfortable",
      flight: comfFlight,
      hotel: comfHotel,
      nights,
      reasoning: "Best guest rating, with the most direct flight available",
    },
  ];

  // Deduplicate — ensure all 3 tiers are distinct
  const seen = new Set();
  const unique = [];
  for (const t of tiers) {
    const key = `${t.flight.id}_${t.hotel.id}`;
    if (!seen.has(key)) {
      unique.push(t);
      seen.add(key);
    }
  }
  // If we lost some to dedup, try swapping hotels to differentiate
  while (unique.length < 3) {
    const missingTier = tiers[unique.length];
    if (!missingTier) break;
    const alternativeHotel = hotels.find((h) => !unique.some((u) => u.hotel.id === h.id));
    const alternativeFlight = flights.find((f) => !unique.some((u) => u.flight.id === f.id));
    if (alternativeHotel) missingTier.hotel = alternativeHotel;
    else if (alternativeFlight) missingTier.flight = alternativeFlight;
    else break;
    const key = `${missingTier.flight.id}_${missingTier.hotel.id}`;
    if (seen.has(key)) break;
    unique.push(missingTier);
    seen.add(key);
  }

  const checkedAt = new Date().toISOString();
  for (const t of unique) {
    t.flightPrice = t.flight.totalPrice;
    t.hotelPrice = t.hotel.pricePerNight * nights;
    t.totalPrice = t.flightPrice + t.hotelPrice;
    t.overBudget = t.totalPrice > brief.budget;
    t.budgetFit = Math.round((t.totalPrice / brief.budget) * 100);
    t.checkedAt = checkedAt;
  }

  const cheapestTotal = Math.min(...unique.map((t) => t.totalPrice));
  for (const t of unique) t.drawback = drawbackFor(t, cheapestTotal);

  return { budget, tiers: unique, nights };
}

// One honest drawback per option, taken from the data. If the data shows none, say so.
function drawbackFor(t, cheapestTotal) {
  const h = t.hotel;
  const f = t.flight;
  if (h.distanceToCenterKm != null && h.distanceToCenterKm > 5) {
    return `${h.distanceToCenterKm} km from city center`;
  }
  if (f.stops > 0) return `Flight has ${f.stops} stop${f.stops > 1 ? "s" : ""}`;
  if (f.oftenDelayed) return "This flight is often delayed by 30+ minutes";
  if ((h.reviewCount || 0) < MIN_REVIEWS) return `Only ${h.reviewCount || 0} hotel reviews so far`;
  if (h.freeCancellation === false) return "No free cancellation";
  if (t.tier !== "cheapest" && t.totalPrice > cheapestTotal) return "Costs more than the cheapest option";
  if (h.freeCancellation == null) return "Cancellation terms not confirmed, check before booking";
  return "No drawback found in the provider data";
}

export function formatPackageMessage(tier, brief) {
  const f = tier.flight;
  const h = tier.hotel;
  const nights = tier.nights;

  const hotelFacts = [
    h.starRating ? `${h.starRating}★` : null,
    h.guestRating != null ? `${h.guestRating.toFixed(1)}/5 (${h.reviewCount || 0} reviews)` : "No guest rating yet",
  ]
    .filter(Boolean)
    .join(" • ");

  const hotelExtras = [
    h.distanceToCenterKm != null ? `${h.distanceToCenterKm} km from center` : null,
    h.breakfastIncluded ? "Breakfast included" : null,
  ]
    .filter(Boolean)
    .join(" • ");

  const flightLink = shortLink(
    f.bookingUrl,
    `https://www.google.com/travel/flights?hl=en&gl=in&q=${encodeURIComponent(
      `flights from ${brief.origin} to ${brief.destination} on ${brief.departDate} returning ${brief.returnDate}`
    )}`
  );
  const hotelLink = shortLink(
    h.bookingUrl,
    `https://www.google.com/travel/search?hl=en&gl=in&q=${encodeURIComponent(`${h.name} ${brief.destination}`)}`
  );

  return (
    `${tier.label} — ₹${tier.totalPrice.toLocaleString("en-IN")}\n\n` +
    `✈️ ${f.airline} ${f.flightNumber} • ${f.stops === 0 ? "Non-stop" : f.stops + " stop"} • ${Math.floor(f.durationMinutes / 60)}h ${f.durationMinutes % 60}m\n` +
    `    Depart ${fmtTime(f.departAt)} → Arrive ${fmtTime(f.arriveAt)}\n\n` +
    `🏨 ${h.name} • ${hotelFacts}\n` +
    `    ₹${h.pricePerNight.toLocaleString("en-IN")}/night × ${nights} nights = ₹${tier.hotelPrice.toLocaleString("en-IN")}\n` +
    (hotelExtras ? `    ${hotelExtras}\n` : "") +
    `\n` +
    `💡 ${tier.reasoning}\n` +
    `⚠️ ${tier.drawback}\n` +
    `📊 ${tier.budgetFit}% of your ₹${brief.budget.toLocaleString("en-IN")} budget${tier.overBudget ? " (over)" : ""}\n` +
    `🕒 Prices checked at ${fmtClock(tier.checkedAt)}\n\n` +
    `🔗 Book this package:\n` +
    `✈️ Flight: ${flightLink}\n` +
    `🏨 Hotel: ${hotelLink}`
  );
}

function shortLink(url, fallback) {
  return url && url.length <= MAX_LINK_LEN ? url : fallback;
}

function fmtTime(iso) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBD";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtClock(iso) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}