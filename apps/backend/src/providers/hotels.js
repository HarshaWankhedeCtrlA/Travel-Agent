// Real hotel provider using SerpAPI Google Hotels.
//
// Everything returned here comes from the provider or is computed from it.
// Anything the provider does not tell us is null (unknown), never a made-up
// default. PRD section 13: no invented rating, stars or conditions.

const SERPAPI_URL = "https://serpapi.com/search";
const TIMEOUT_MS = 20000;

const nightsBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000));

export async function searchHotels({ city, checkIn, checkOut, travelers = 1 }) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY not set");

  const nights = nightsBetween(checkIn, checkOut);

  const url = new URL(SERPAPI_URL);
  url.searchParams.set("engine", "google_hotels");
  url.searchParams.set("q", `hotels in ${city}`);
  url.searchParams.set("check_in_date", checkIn);
  url.searchParams.set("check_out_date", checkOut);
  url.searchParams.set("adults", String(travelers));
  url.searchParams.set("currency", "INR");
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "in");
  url.searchParams.set("api_key", apiKey);

  // Never log the URL: it contains the API key
  console.log(`[hotels] search ${city} ${checkIn} to ${checkOut} (${travelers} adult${travelers > 1 ? "s" : ""})`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "SerpAPI hotels timed out" : `SerpAPI hotels failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);

  const data = await res.json();
  if (data.error) {
    const errMsg = String(data.error).toLowerCase();
    if (errMsg.includes("no results")) return [];
    throw new Error(`SerpAPI: ${data.error}`);
  }

  const raw = (data.properties || []).slice(0, 15);

  // City centre. The middle of the hotels found is a safe anchor, and the
  // geocoder is only trusted when it names a place next to those hotels
  // (a plain search for "Goa" can return a town on another continent).
  const coords = raw
    .map((h) => h.gps_coordinates)
    .filter((g) => g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude));
  const anchor = coords.length
    ? { lat: median(coords.map((g) => g.latitude)), lng: median(coords.map((g) => g.longitude)) }
    : null;
  const center = await getCityCenter(city, anchor);

  const mapped = raw
    .map((h) => {
      // Only the numeric fields. The text ones ("₹2,078") are not numbers.
      const perNight = h.rate_per_night?.extracted_lowest;
      const total = h.total_rate?.extracted_lowest;
      const pricePerNight =
        Number.isFinite(perNight) && perNight > 0
          ? perNight
          : Number.isFinite(total) && total > 0
          ? total / nights // a stay total, not a nightly price
          : 0;

      let distanceKm = null;
      if (h.gps_coordinates && center) {
        distanceKm =
          Math.round(
            haversine(center.lat, center.lng, h.gps_coordinates.latitude, h.gps_coordinates.longitude) * 10
          ) / 10;
      }

      const amenities = Array.isArray(h.amenities) ? h.amenities : null;

      return {
        id: `ht_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: h.name || `Hotel in ${city}`,
        isRental: String(h.type || "").toLowerCase().includes("rental"),
        starRating: starsOf(h), // null unless the provider gives a hotel class
        guestRating: Number.isFinite(h.overall_rating) ? h.overall_rating : null,
        reviewCount: h.reviews || 0,
        pricePerNight: Math.round(pricePerNight),
        pricePerNightBeforeTaxes: Number.isFinite(h.rate_per_night?.extracted_before_taxes_fees)
          ? Math.round(h.rate_per_night.extracted_before_taxes_fees)
          : null,
        currency: "INR",
        distanceToCenterKm: distanceKm,
        // true when the provider lists it, otherwise unknown (not "no")
        breakfastIncluded: amenities && amenities.some((a) => /breakfast/i.test(a)) ? true : null,
        freeCancellation: typeof h.free_cancellation === "boolean" ? h.free_cancellation : null,
        gps: h.gps_coordinates || null,
        bookingUrl: isDeepLink(h.link)
          ? h.link
          : `https://www.google.com/travel/search?hl=en&gl=in&q=${encodeURIComponent(`${h.name} ${city}`)}`,
        source: "google_hotels",
      };
    })
    .filter((h) => h.pricePerNight > 0);

  // Real hotels first. Keep apartments and rentals only if there are too few hotels.
  const hotelsOnly = mapped.filter((h) => !h.isRental);
  const list = hotelsOnly.length >= 3 ? hotelsOnly : mapped;

  console.log(`[hotels] ${list.length} usable results (${hotelsOnly.length} hotels, ${mapped.length - hotelsOnly.length} rentals)`);
  return list.slice(0, 8);
}

function starsOf(h) {
  const clamp = (n) => Math.min(5, Math.max(1, Math.round(n)));
  if (typeof h.extracted_hotel_class === "number") return clamp(h.extracted_hotel_class);
  if (typeof h.hotel_class === "number") return clamp(h.hotel_class);
  if (typeof h.hotel_class === "string") {
    const m = h.hotel_class.match(/(\d)/);
    if (m) return clamp(parseInt(m[1], 10));
  }
  return null;
}

// A link to the property itself, not just the booking site's home page
function isDeepLink(link) {
  if (!link) return false;
  try {
    return new URL(link).pathname.length > 1;
  } catch {
    return false;
  }
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Of all the places called `city`, take the one closest to the hotels found.
async function getCityCenter(city, anchor) {
  if (!anchor) return null;
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&format=json`
    );
    const data = await res.json();
    const nearest = (data.results || [])
      .map((r) => ({
        lat: r.latitude,
        lng: r.longitude,
        d: haversine(anchor.lat, anchor.lng, r.latitude, r.longitude),
      }))
      .sort((a, b) => a.d - b.d)[0];
    return nearest && nearest.d <= 100 ? { lat: nearest.lat, lng: nearest.lng } : anchor;
  } catch {
    return anchor;
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Higher is better. A missing rating or star class counts as 0; more reviews
// mean the rating can be trusted a little more.
export function scoreHotel(h, nights) {
  const dist = h.distanceToCenterKm ?? 5;
  const confidence = Math.min(Math.log10(1 + (h.reviewCount || 0)), 3) * 5;
  return (
    (h.guestRating ?? 0) * 20 +
    (h.starRating ?? 0) * 15 +
    confidence -
    h.pricePerNight * nights * 0.01 -
    dist * 3
  );
}