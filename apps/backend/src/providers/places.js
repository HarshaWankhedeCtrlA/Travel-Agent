// Real places provider using SerpAPI Google Maps.

const SERPAPI_URL = "https://serpapi.com/search";

export async function searchPlaces({ city }) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY not set");

  const url = new URL(SERPAPI_URL);
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("q", `tourist attractions in ${city}`);
  url.searchParams.set("type", "search");
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "in");
  url.searchParams.set("api_key", apiKey);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(`SerpAPI: ${data.error}`);

  const raw = (data.local_results || []).slice(0, 12);

  return raw.map((p, i) => ({
    id: `place_${Date.now()}_${i}`,
    name: p.title || `Attraction ${i + 1}`,
    category: guessCategory(p.type || p.title || ""),
    openHours: p.hours || "Check locally",
    entryFee: 0,
    durationMin: 90,
    lat: p.gps_coordinates?.latitude || 0,
    lng: p.gps_coordinates?.longitude || 0,
    rating: p.rating || 4.0,
  }));
}

function guessCategory(type) {
  const t = String(type).toLowerCase();
  if (t.includes("beach")) return "beach";
  if (t.includes("fort") || t.includes("castle")) return "fort";
  if (t.includes("temple") || t.includes("church")) return "temple";
  if (t.includes("market") || t.includes("bazaar")) return "market";
  if (t.includes("museum")) return "museum";
  if (t.includes("park") || t.includes("garden") || t.includes("falls")) return "nature";
  if (t.includes("restaurant") || t.includes("cafe")) return "restaurant";
  return "attraction";
}