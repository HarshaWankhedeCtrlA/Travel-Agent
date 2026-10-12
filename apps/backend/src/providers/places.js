// Real places provider using SerpAPI Google Maps.

const SERPAPI_URL = "https://serpapi.com/search";

export async function searchPlaces({ city }) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY not set");

  // Query attractions AND restaurants in parallel
  const [attractions, restaurants] = await Promise.all([
    searchPlacesQuery({ apiKey, q: `tourist attractions in ${city}` }),
    searchPlacesQuery({ apiKey, q: `top restaurants in ${city}` }),
  ]);

  const normalized = [
    ...attractions.map((p) => normalize(p, "attraction")),
    ...restaurants.map((p) => normalize(p, "restaurant")),
  ];

  return normalized;
}

async function searchPlacesQuery({ apiKey, q }) {
  const url = new URL(SERPAPI_URL);
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "search");
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "in");
  url.searchParams.set("api_key", apiKey);

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.error) return [];
    return data.local_results || [];
  } catch {
    return [];
  }
}

function normalize(p, hint) {
  const type = String(p.type || p.title || "").toLowerCase();
  return {
    id: `place_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: p.title || "Unnamed",
    category: hint === "restaurant" ? "restaurant" : guessCategory(type),
    openHours: p.hours || null,
    entryFee: 0,
    durationMin: 90,
    lat: p.gps_coordinates?.latitude || null,
    lng: p.gps_coordinates?.longitude || null,
    rating: p.rating || null,
    address: p.address || null,
    priceBand: p.price || null,  // e.g. "₹₹"
    source: "google_maps",
  };
}

function guessCategory(type) {
  const t = String(type).toLowerCase();
  if (t.includes("beach")) return "beach";
  if (t.includes("fort") || t.includes("castle") || t.includes("palace")) return "fort";
  if (t.includes("temple") || t.includes("church") || t.includes("mosque")) return "temple";
  if (t.includes("market") || t.includes("bazaar") || t.includes("mall")) return "market";
  if (t.includes("museum") || t.includes("gallery")) return "museum";
  if (t.includes("park") || t.includes("garden") || t.includes("falls") || t.includes("lake")) return "nature";
  if (t.includes("restaurant") || t.includes("cafe") || t.includes("bar") || t.includes("dhaba")) return "restaurant";
  if (t.includes("viewpoint") || t.includes("lookout")) return "viewpoint";
  return "attraction";
}