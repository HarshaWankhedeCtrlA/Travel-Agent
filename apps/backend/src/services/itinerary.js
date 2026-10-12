import { searchPlaces } from "../providers/places.js";
import { getWeather } from "../providers/weather.js";
import { nightsBetween } from "./budget.js";

const COASTAL_CITIES = [
  "goa", "mumbai", "chennai", "kerala", "andaman", "bali",
  "phuket", "pondicherry", "kovalam", "varkala", "gokarna",
];

export async function buildItinerary(trip) {
  const brief = trip.brief;
  const chosen = (trip.packages || []).find((p) => p.tier === trip.chosenTier);
  if (!chosen) throw new Error("No chosen package");

  const nights = nightsBetween(brief.departDate, brief.returnDate);
  const days = nights + 1;

  // Fetch real data in parallel
  const [places, weather] = await Promise.all([
    searchPlaces({ city: brief.destination }).catch(() => []),
    getWeather({
      city: brief.destination,
      departDate: brief.departDate,
      returnDate: brief.returnDate,
    }).catch(() => null),
  ]);

  const isCoastal = COASTAL_CITIES.some((c) =>
    (brief.destination || "").toLowerCase().includes(c)
  );

  const beaches = isCoastal ? places.filter((p) => p.category === "beach") : [];
  const forts = places.filter((p) => p.category === "fort");
  const temples = places.filter((p) => p.category === "temple");
  const markets = places.filter((p) => p.category === "market");
  const museums = places.filter((p) => p.category === "museum");
  const nature = places.filter((p) => p.category === "nature");
  const restaurants = places.filter((p) => p.category === "restaurant");
  const general = places.filter((p) => p.category === "attraction" || p.category === "viewpoint");

  // Deduped pool
  const seen = new Set();
  const activityPool = [];
  for (const p of [...forts, ...temples, ...markets, ...nature, ...museums, ...general]) {
    if (p.name && !seen.has(p.name)) {
      activityPool.push(p);
      seen.add(p.name);
    }
  }

  const diningPool = [];
  const seenDining = new Set();
  for (const p of restaurants) {
    if (p.name && !seenDining.has(p.name)) {
      diningPool.push(p);
      seenDining.add(p.name);
    }
  }

  const itinerary = [];
  let activityIdx = 0;
  let diningIdx = 0;

  for (let i = 0; i < days; i++) {
    const date = addDays(brief.departDate, i);
    const isArrival = i === 0;
    const isDeparture = i === days - 1;

    const day = {
      dayNumber: i + 1,
      date,
      label: isArrival ? "Arrival" : isDeparture ? "Departure" : `Day ${i + 1}`,
      morning: [],
      afternoon: [],
      evening: [],
      transfer: null,
      notes: [],
    };

    if (isArrival) {
      day.notes.push(`Arrive at ${brief.destination}`);
      day.transfer = `Airport → ${chosen.hotel.name}`;
      const first = beaches[0] || activityPool[activityIdx++];
      if (first) day.afternoon.push(first.name);
      const dinner = diningPool[diningIdx++];
      if (dinner) day.evening.push(dinner.name);
    } else if (isDeparture) {
      const departHour = chosen.flight.departAt
        ? new Date(chosen.flight.departAt).getHours()
        : 11;
      day.morning.push("Breakfast at hotel");
      if (departHour < 9) {
        day.notes.push("Check out by 5:00 am for early flight");
        day.notes.push("⚠️ Book airport cab the night before");
      } else {
        day.notes.push("Check out by 11:00 am");
      }
      day.notes.push(`Flight ${chosen.flight.flightNumber} departs ${fmtTime(chosen.flight.departAt)}`);
    } else {
      const m = activityPool[activityIdx++];
      const a = beaches[0] || activityPool[activityIdx++];
      const e = diningPool[diningIdx++];
      if (m) day.morning.push(m.name);
      if (a) day.afternoon.push(a.name);
      if (e) day.evening.push(e.name);
    }

    day.morning = day.morning.filter(Boolean);
    day.afternoon = day.afternoon.filter(Boolean);
    day.evening = day.evening.filter(Boolean);
    itinerary.push(day);
  }

  return {
    days: itinerary,
    summary: buildSummary(trip, chosen, itinerary),
    packing: buildPacking(brief, weather),
    weather: weather
      ? `${weather.location}: ${weather.minTemp}–${weather.maxTemp}°C, ${weather.summary}` +
        (weather.rainMm > 0 ? `, ~${weather.rainMm}mm rain` : "")
      : "Weather data unavailable",
    documents: ["Government ID", "Flight tickets", "Hotel confirmation", "Travel insurance (optional)"],
  };
}

function buildSummary(trip, chosen, itinerary) {
  const brief = trip.brief;
  const mealCost = itinerary.length * 1500;
  const activityCost = itinerary.length * 800;
  const spendEstimate = chosen.totalPrice + mealCost + activityCost;
  const overBudget = spendEstimate - brief.budget;
  return {
    flight: `${chosen.flight.airline} ${chosen.flight.flightNumber}`,
    hotel: chosen.hotel.name,
    packagePrice: chosen.totalPrice,
    spendEstimate,
    budget: brief.budget,
    overBudget: overBudget > 0 ? overBudget : 0,
  };
}

function buildPacking(brief, weather) {
  const dest = (brief.destination || "").toLowerCase();
  if (["manali", "shimla", "leh", "srinagar", "auli", "darjeeling"].some((d) => dest.includes(d))) {
    return ["Warm jacket", "Thermals", "Trekking shoes", "Gloves", "Beanie", "Moisturizer", "Sunglasses"];
  }
  // Use real weather if cold temps are forecast
  if (weather && weather.minTemp != null && weather.minTemp < 15) {
    return ["Light jacket", "Layers", "Comfortable shoes", "Sunglasses", "Basic medicines"];
  }
  if (weather && weather.rainMm > 20) {
    return ["Umbrella", "Waterproof shoes", "Light layers", "Sunglasses", "Basic medicines"];
  }
  return ["Comfortable shoes", "Light layers", "Sunglasses", "Basic medicines", "Power bank", "Reusable bottle"];
}

export function formatDayMessage(day) {
  const lines = [`Day ${day.dayNumber} — ${fmtDate(day.date)} (${day.label})`];
  if (day.morning.length) lines.push(`🌅 Morning: ${day.morning.join(", ")}`);
  if (day.afternoon.length) lines.push(`☀️ Afternoon: ${day.afternoon.join(", ")}`);
  if (day.evening.length) lines.push(`🌙 Evening: ${day.evening.join(", ")}`);
  if (day.transfer) lines.push(`🚕 ${day.transfer}`);
  if (day.notes.length) lines.push(day.notes.map((n) => `• ${n}`).join("\n"));
  return lines.join("\n");
}

export function formatSummaryMessage(summary, packing, weather, documents) {
  const over =
    summary.overBudget > 0
      ? `\n⚠️ ₹${summary.overBudget.toLocaleString("en-IN")} over your ₹${summary.budget.toLocaleString("en-IN")} budget`
      : `\n✅ Within your ₹${summary.budget.toLocaleString("en-IN")} budget`;
  return (
    `📋 Trip Summary\n\n` +
    `✈️ ${summary.flight}\n` +
    `🏨 ${summary.hotel}\n` +
    `💰 Package: ₹${summary.packagePrice.toLocaleString("en-IN")}\n` +
    `💸 Est. total (with meals + activities): ₹${summary.spendEstimate.toLocaleString("en-IN")}${over}\n\n` +
    `🌡️ Weather: ${weather}\n\n` +
    `📋 Packing: ${packing.join(", ")}\n\n` +
    `📄 Documents: ${documents.join(", ")}`
  );
}

// ─── Helpers ─────────────────────────────────────────────
function addDays(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function fmtTime(iso) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}