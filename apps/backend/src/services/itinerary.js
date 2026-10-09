import { searchPlaces } from "../providers/places.js";
import { nightsBetween } from "./budget.js";

// Time slot rules (approximate)
const SLOTS = {
  morning:   { start: "09:00", end: "13:00", minutes: 240 },
  afternoon: { start: "14:00", end: "18:00", minutes: 240 },
  evening:   { start: "19:00", end: "22:00", minutes: 180 },
};

export async function buildItinerary(trip) {
  const brief = trip.brief;
  const chosen = (trip.packages || []).find((p) => p.tier === trip.chosenTier);
  if (!chosen) throw new Error("No chosen package");

  const nights = nightsBetween(brief.departDate, brief.returnDate);
  const days = nights + 1; // arrival day + nights

  const places = await searchPlaces({ city: brief.destination });

  const beaches = places.filter((p) => p.category === "beach");
  const forts = places.filter((p) => p.category === "fort");
  const temples = places.filter((p) => p.category === "temple");
  const markets = places.filter((p) => p.category === "market");
  const museums = places.filter((p) => p.category === "museum");
  const nature = places.filter((p) => p.category === "nature");
  const restaurants = places.filter((p) => p.category === "restaurant");

  const itinerary = [];

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
      meals: [],
      transfer: null,
      notes: [],
    };

    if (isArrival) {
      day.notes.push(`Arrive at ${brief.destination} airport`);
      day.transfer = `Airport → ${chosen.hotel.name} (30 min, ₹600)`;
      day.afternoon.push(beaches[i % beaches.length]?.name || "Relax at hotel");
      day.evening.push(restaurants[i % restaurants.length]?.name || "Dinner at hotel");
    } else if (isDeparture) {
      day.morning.push("Breakfast at hotel");
      day.notes.push(`Check out by 11:00 am`);
      day.notes.push(`Flight ${chosen.flight.flightNumber} departs ${fmtTime(chosen.flight.departAt)}`);
    } else {
      const siteIdx = (i - 1) % 4;
      if (siteIdx === 0) {
        day.morning.push(forts[0]?.name || "Local fort");
        day.afternoon.push(beaches[0]?.name || "Beach time");
        day.evening.push("Sunset at Chapora Fort");
      } else if (siteIdx === 1) {
        day.morning.push(temples[0]?.name || "Local temple");
        day.afternoon.push(markets[0]?.name || "Local market");
        day.evening.push(restaurants[1]?.name || "Dinner out");
      } else if (siteIdx === 2) {
        day.morning.push(nature[0]?.name || "Nature spot");
        day.afternoon.push(beaches[1]?.name || "Beach time");
        day.evening.push("Relax at hotel");
      } else {
        day.morning.push(museums[0]?.name || "Local museum");
        day.afternoon.push(beaches[2]?.name || "Beach time");
        day.evening.push(restaurants[2]?.name || "Dinner out");
      }
    }

    // Meal cost band
    const mealCost = chosen.totalPrice > brief.budget ? "₹1,500-2,000" : "₹800-1,200";
    day.meals.push({ label: "Breakfast", cost: chosen.hotel.breakfastIncluded ? "included" : "₹300-500" });
    day.meals.push({ label: "Lunch", cost: "₹400-600" });
    day.meals.push({ label: "Dinner", cost: mealCost });

    itinerary.push(day);
  }

  return {
    days: itinerary,
    summary: buildSummary(trip, chosen, itinerary),
    packing: buildPacking(brief),
    weather: "22–30°C, mostly sunny with occasional showers",
    documents: ["Government ID", "Flight tickets", "Hotel confirmation", "Travel insurance (optional)"],
  };
}

function buildSummary(trip, chosen, itinerary) {
  const brief = trip.brief;
  const spendEstimate = chosen.totalPrice + itinerary.length * 1500; // +meals
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

function buildPacking(brief) {
  const base = ["Sunscreen SPF50", "Swimwear", "Flip-flops", "Light cottons", "Sunglasses", "Hat"];
  const dest = (brief.destination || "").toLowerCase();
  if (dest.includes("manali") || dest.includes("shimla") || dest.includes("leh")) {
    return ["Warm jacket", "Thermals", "Trekking shoes", "Gloves", "Beanie", "Moisturizer"];
  }
  return base;
}

export function formatDayMessage(day, brief) {
  const lines = [`Day ${day.dayNumber} — ${fmtDate(day.date)} (${day.label})`];
  if (day.morning.length)   lines.push(`🌅 Morning: ${day.morning.join(", ")}`);
  if (day.afternoon.length) lines.push(`☀️ Afternoon: ${day.afternoon.join(", ")}`);
  if (day.evening.length)   lines.push(`🌙 Evening: ${day.evening.join(", ")}`);
  if (day.transfer)         lines.push(`🚕 ${day.transfer}`);
  if (day.notes.length)     lines.push(day.notes.map((n) => `• ${n}`).join("\n"));
  return lines.join("\n");
}

export function formatSummaryMessage(summary, packing, weather, documents) {
  const over = summary.overBudget > 0
    ? `\n⚠️ ₹${summary.overBudget.toLocaleString("en-IN")} over your ₹${summary.budget.toLocaleString("en-IN")} budget`
    : `\n✅ Within your ₹${summary.budget.toLocaleString("en-IN")} budget`;
  return (
    `📋 Trip Summary\n\n` +
    `✈️ ${summary.flight}\n` +
    `🏨 ${summary.hotel}\n` +
    `💰 Package: ₹${summary.packagePrice.toLocaleString("en-IN")}\n` +
    `💸 Est. total (with meals): ₹${summary.spendEstimate.toLocaleString("en-IN")}${over}\n\n` +
    `🌡️ Weather: ${weather}\n\n` +
    `📋 Packing: ${packing.join(", ")}\n\n` +
    `📄 Documents: ${documents.join(", ")}`
  );
}

// ─── Helpers ─────────────────────────────────────────────────
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
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}