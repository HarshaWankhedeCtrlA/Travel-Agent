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
  if (data.error) throw new Error(`SerpAPI: ${data.error}`);

  const raw = (data.properties || []).slice(0, 10);

  return raw
    .map((h) => {
      // Try multiple places for price
      const pricePerNight =
        h.rate_per_night?.extracted_lowest ||
        h.rate_per_night?.lowest ||
        h.total_rate?.extracted_lowest ||
        h.total_rate?.lowest ||
        0;

      const rating = h.overall_rating || 4.0;
      const stars = h.hotel_class || Math.round(rating);

      return {
        id: `ht_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: h.name || `Hotel in ${city}`,
        starRating: stars,
        guestRating: rating,
        reviewCount: h.reviews || 0,
        pricePerNight: Math.round(pricePerNight),
        currency: "INR",
        distanceToCenterKm: 2.5,
        breakfastIncluded: false,
        freeCancellation: false,
      };
    })
    .filter((h) => h.pricePerNight > 0)
    .slice(0, 6);
}

export function scoreHotel(h, nights) {
  return (
    h.guestRating * 20 +
    h.starRating * 15 -
    h.pricePerNight * nights * 0.01
  );
}