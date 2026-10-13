// Real flight provider using SerpAPI Google Flights.
//
// Everything returned here comes from the provider. Fields the provider does not
// give us are null (unknown), never a made-up default. PRD section 13: the agent
// never claims a price, rating or condition that is not in the provider data.

const SERPAPI_URL = "https://serpapi.com/search";
const TIMEOUT_MS = 20000;

const IATA = {
  // Metro
  delhi: "DEL", "new delhi": "DEL", mumbai: "BOM", bangalore: "BLR",
  bengaluru: "BLR", chennai: "MAA", kolkata: "CCU", hyderabad: "HYD",
  pune: "PNQ", ahmedabad: "AMD", jaipur: "JAI", kochi: "COK",
  lucknow: "LKO", varanasi: "VNS", udaipur: "UDR", goa: "GOI",
  // Regional (nearest airports)
  bhusawal: "JLG",    // Jalgaon
  jalgaon: "JLG",
  aurangabad: "IXU",
  nashik: "ISK",
  nagpur: "NAG",
  indore: "IDR",
  bhopal: "BHO",
  surat: "STV",
  vadodara: "BDQ",
  rajkot: "RAJ",
  amritsar: "ATQ",
  chandigarh: "IXC",
  dehradun: "DED",
  // Hill stations
  manali: "KUU", shimla: "SLV", srinagar: "SXR", leh: "IXL",
  rishikesh: "DED", nainital: "PGH", darjeeling: "IXB",
  // South
  coorg: "IXE", ooty: "CJB", munnar: "COK", pondicherry: "PNY",
  madurai: "IXM", coimbatore: "CJB", thiruvananthapuram: "TRV",
  // International
  bali: "DPS", dubai: "DXB", singapore: "SIN", bangkok: "BKK",
  paris: "CDG", london: "LHR", tokyo: "NRT", "new york": "JFK",
};

// Unknown city -> null. It used to take the first 3 letters of the name
// ("Kullu" became KUL, which is Kuala Lumpur) and search the wrong airport.
function toIATA(city) {
  if (!city) return null;
  return IATA[String(city).trim().toLowerCase()] || null;
}

const isValidDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

export async function searchFlights({ origin, destination, departDate, returnDate, travelers = 1 }) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY not set");

  const from = toIATA(origin);
  const to = toIATA(destination);
  if (!from || !to) {
    const unknown = !from ? origin : destination;
    // The orchestrator turns messages starting with "No flights" into a friendly reply
    throw new Error(`No flights: no airport known for "${unknown}". Try a nearby major city.`);
  }

  const url = new URL(SERPAPI_URL);
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("departure_id", from);
  url.searchParams.set("arrival_id", to);
  url.searchParams.set("outbound_date", departDate);

  if (isValidDate(returnDate)) {
    url.searchParams.set("return_date", returnDate);
    url.searchParams.set("type", "1"); // round trip
  } else {
    url.searchParams.set("type", "2"); // one way
  }

  url.searchParams.set("currency", "INR");
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "in");
  url.searchParams.set("api_key", apiKey);

  // Never log the URL: it contains the API key
  console.log(
    `[flights] search ${from}→${to} ${departDate}${isValidDate(returnDate) ? ` to ${returnDate}` : ""} (${travelers} traveler${travelers > 1 ? "s" : ""})`
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "SerpAPI flights timed out" : `SerpAPI flights failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);

  const data = await res.json();

  if (data.error) {
    const errMsg = String(data.error).toLowerCase();
    // "no results" is a valid response, not an error — return empty
    if (errMsg.includes("hasn't returned any results") || errMsg.includes("no results")) {
      return [];
    }
    throw new Error(`SerpAPI: ${data.error}`);
  }

  const raw = [...(data.best_flights || []), ...(data.other_flights || [])].slice(0, 8);

  const flights = raw
    .filter((f) => f.price && f.price > 0)
    .slice(0, 6)
    .map((f, i) => {
      const legs = f.flights || [];
      const first = legs[0] || {};
      const last = legs[legs.length - 1] || {};
      const stops = Math.max(0, legs.length - 1);

      const bookingUrl = f.booking_token
        ? `https://www.google.com/travel/flights/booking?hl=en&gl=in&token=${encodeURIComponent(f.booking_token)}`
        : `https://www.google.com/travel/flights?hl=en&gl=in&q=${encodeURIComponent(`flights from ${origin} to ${destination} on ${departDate}`)}`;

      return {
        id: `fl_${Date.now()}_${i}`,
        airline: first.airline || "Unknown",
        flightNumber: first.flight_number || "",
        origin: first.departure_airport?.id || from,
        destination: last.arrival_airport?.id || to,
        departAt: first.departure_airport?.time || "",
        arriveAt: last.arrival_airport?.time || "",
        durationMinutes: f.total_duration || 0,
        stops,
        // Real, from the provider
        layoverMinutes: (f.layovers || []).reduce((sum, l) => sum + (l.duration || 0), 0),
        // The provider flags only flights that are often late, so false means "not flagged"
        oftenDelayed: legs.some((l) => l.often_delayed_by_over_30_min === true),
        pricePerPerson: f.price,
        totalPrice: f.price * travelers,
        currency: "INR",
        // Not in the data we read, so unknown. Do not show these as facts.
        baggageIncluded: null,
        refundable: null,
        bookingUrl,
      };
    });

  if (flights.length) {
    const cheapest = flights.reduce((a, b) => (a.pricePerPerson <= b.pricePerPerson ? a : b));
    console.log(
      `[flights] ${flights.length} usable results; cheapest ₹${cheapest.pricePerPerson} per person (${cheapest.airline}, ${cheapest.stops} stop${cheapest.stops === 1 ? "" : "s"})`
    );
  } else {
    console.log("[flights] no usable results");
  }

  return flights;
}

export function scoreFlight(f) {
  // Lower is better. A flight the provider flags as often late costs extra.
  return f.totalPrice * 0.6 + f.stops * 2000 + f.durationMinutes * 15 + (f.oftenDelayed ? 1500 : 0);
}