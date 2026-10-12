// Real hotel provider using SerpAPI Google Hotels.

const SERPAPI_URL = "https://serpapi.com/search";

export async function searchHotels({ city, checkIn, checkOut, travelers = 1 }) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY not set");

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

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);

  const data = await res.json();
  if (data.error) {
    const errMsg = String(data.error).toLowerCase();
    if (errMsg.includes("no results")) return [];
    throw new Error(`SerpAPI: ${data.error}`);
  }

  // Get city center coordinates for distance calc
  const cityCenter = await getCityCenter(city);

  const raw = (data.properties || []).slice(0, 15);

  return raw
    .map((h) => {
      const pricePerNight =
        h.rate_per_night?.extracted_lowest ||
        h.rate_per_night?.lowest ||
        h.total_rate?.extracted_lowest ||
        h.total_rate?.lowest ||
        0;

      const rating = h.overall_rating || 4.0;
    let stars = 3;
if (typeof h.hotel_class === "number") {
  stars = Math.min(5, Math.max(1, Math.round(h.hotel_class)));
} else if (typeof h.hotel_class === "string") {
  const m = h.hotel_class.match(/(\d)/);
  stars = m ? Math.min(5, Math.max(1, parseInt(m[1], 10))) : Math.round(rating);
} else if (rating) {
  stars = Math.round(rating);
}
      // Distance from city center (real, computed)
      let distanceKm = null;
      if (h.gps_coordinates && cityCenter) {
        distanceKm =
          Math.round(
            haversine(
              cityCenter.lat,
              cityCenter.lng,
              h.gps_coordinates.latitude,
              h.gps_coordinates.longitude
            ) * 10
          ) / 10;
      }

      return {
        id: `ht_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: h.name || `Hotel in ${city}`,
        starRating: stars,
        guestRating: rating,
        reviewCount: h.reviews || 0,
        pricePerNight: Math.round(pricePerNight),
        currency: "INR",
        distanceToCenterKm: distanceKm,
        breakfastIncluded: !!h.breakfast_included,
        freeCancellation: !!h.free_cancellation,
        gps: h.gps_coordinates || null,
        bookingUrl: h.link || `https://www.google.com/travel/search?hl=en&gl=in&q=${encodeURIComponent(`${h.name} ${city}`)}`, 
        source: "google_hotels",
      };
    })
    .filter((h) => h.pricePerNight > 0)
    .slice(0, 8);
}

async function getCityCenter(city) {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&format=json`
    );
    const data = await res.json();
    if (!data.results?.length) return null;
    return { lat: data.results[0].latitude, lng: data.results[0].longitude };
  } catch {
    return null;
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

export function scoreHotel(h, nights) {
  const dist = h.distanceToCenterKm ?? 5;
  return (
    h.guestRating * 20 +
    h.starRating * 15 -
    h.pricePerNight * nights * 0.01 -
    dist * 3
  );
}