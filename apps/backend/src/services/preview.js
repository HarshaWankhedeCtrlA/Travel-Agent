// Free preview (PRD section 11, flow F3): shown after the brief is confirmed and
// BEFORE the fee. It must be cheap, because most previews never turn into a payment.
//
//  - No flight or hotel search here. Those calls start only after the fee is paid.
//  - Budget split is a plan for the traveler's own money (a target), not a price.
//  - Weather is free (Open-Meteo).
//  - The sample day uses real places from the places provider, cached per city,
//    so repeated previews for the same destination cost nothing.
//  - Nothing here is invented: if a source returns nothing, that part is left out.

import { searchPlaces } from "../providers/places.js";
import { getWeather } from "../providers/weather.js";

const BUFFER = 0.1; // PRD section 7: keep 5 to 10 percent for taxes, baggage, local costs
const SPLIT = { flights: 0.4, stay: 0.4, local: 0.2 }; // PRD section 7 default 40 / 40 / 20

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 200;
const placeCache = new Map(); // city -> { at, places }

async function placesFor(city) {
  const key = String(city || "").trim().toLowerCase();
  const hit = placeCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.places;

  const places = await searchPlaces({ city }).catch(() => []);
  if (places.length) {
    if (placeCache.size >= MAX_CACHE) placeCache.delete(placeCache.keys().next().value);
    placeCache.set(key, { at: Date.now(), places });
  }
  return places;
}

const round100 = (n) => Math.round(n / 100) * 100;

export async function buildPreview(trip) {
  const b = trip.brief;
  const nights = Math.max(1, Math.round((new Date(b.returnDate) - new Date(b.departDate)) / 86400000));
  const usable = b.budget * (1 - BUFFER);

  const [places, weather] = await Promise.all([
    placesFor(b.destination),
    getWeather({ city: b.destination, departDate: b.departDate, returnDate: b.returnDate }).catch(() => null),
  ]);

  const stay = round100(usable * SPLIT.stay);

  return {
    destination: b.destination,
    nights,
    travelers: b.travelers,
    budget: b.budget,
    split: {
      flights: round100(usable * SPLIT.flights),
      stay,
      stayPerNight: round100(stay / nights),
      local: round100(usable * SPLIT.local),
      buffer: round100(b.budget * BUFFER),
    },
    weather: weather
      ? `${weather.location}: ${weather.minTemp}–${weather.maxTemp}°C, ${weather.summary}` +
        (weather.rainMm > 0 ? `, ~${weather.rainMm}mm rain` : "")
      : null,
    sample: pickSampleDay(places),
  };
}

// Best-rated real places from the provider: two sights and one place to eat.
function pickSampleDay(places) {
  const byRating = (a, b) => (b.rating || 0) - (a.rating || 0);
  const unique = (list) => {
    const seen = new Set();
    const out = [];
    for (const p of list) {
      if (p.name && !seen.has(p.name)) {
        seen.add(p.name);
        out.push(p);
      }
    }
    return out;
  };

  const spots = unique(places.filter((p) => p.category !== "restaurant").sort(byRating));
  const food = unique(places.filter((p) => p.category === "restaurant").sort(byRating));
  if (spots.length === 0 && food.length === 0) return null;

  return {
    morning: spots[0]?.name || null,
    afternoon: spots[1]?.name || null,
    evening: food[0]?.name || null,
  };
}

const LABELS = {
  en: {
    title: (d) => `Here's a free preview for ${d}`,
    budgetHead: "📊 How your budget splits",
    budgetLine: (p) =>
      `₹${p.budget.toLocaleString("en-IN")} total · ${p.travelers} traveler${p.travelers > 1 ? "s" : ""} · ${p.nights} night${p.nights > 1 ? "s" : ""}`,
    flights: "Flights",
    stay: "Stay",
    perNight: "night",
    local: "Food + activities",
    buffer: "Buffer for taxes, baggage, local costs",
    note: "These are targets for your budget, not prices. Real fares and hotels come after you continue.",
    weather: "🌡️ Weather",
    sampleHead: "📍 A sample day",
    morning: "🌅 Morning",
    afternoon: "☀️ Afternoon",
    evening: "🌙 Evening",
  },
  hinglish: {
    title: (d) => `${d} ka free preview ye raha`,
    budgetHead: "📊 Aapka budget kaise bantega",
    budgetLine: (p) =>
      `₹${p.budget.toLocaleString("en-IN")} total · ${p.travelers} log · ${p.nights} raat`,
    flights: "Flights",
    stay: "Rehna",
    perNight: "raat",
    local: "Khana + activities",
    buffer: "Tax, baggage, local kharche ka buffer",
    note: "Ye aapke budget ke targets hain, prices nahi. Asli fares aur hotels aage badhne ke baad aayenge.",
    weather: "🌡️ Mausam",
    sampleHead: "📍 Ek sample din",
    morning: "🌅 Subah",
    afternoon: "☀️ Dopahar",
    evening: "🌙 Shaam",
  },
};

export function formatPreviewMessage(p, lang) {
  const L = lang === "hinglish" || lang === "hi" ? LABELS.hinglish : LABELS.en;
  const inr = (n) => `₹${n.toLocaleString("en-IN")}`;

  const lines = [
    L.title(p.destination),
    "",
    L.budgetHead,
    L.budgetLine(p),
    `• ${L.flights} ≈ ${inr(p.split.flights)}`,
    `• ${L.stay} ≈ ${inr(p.split.stay)} (${inr(p.split.stayPerNight)}/${L.perNight})`,
    `• ${L.local} ≈ ${inr(p.split.local)}`,
    `• ${L.buffer}: ${inr(p.split.buffer)}`,
    L.note,
  ];

  if (p.weather) lines.push("", `${L.weather}: ${p.weather}`);

  if (p.sample) {
    lines.push("", L.sampleHead);
    if (p.sample.morning) lines.push(`${L.morning}: ${p.sample.morning}`);
    if (p.sample.afternoon) lines.push(`${L.afternoon}: ${p.sample.afternoon}`);
    if (p.sample.evening) lines.push(`${L.evening}: ${p.sample.evening}`);
  }

  return lines.join("\n");
}