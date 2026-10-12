// Real flight provider using SerpAPI Google Flights.

const SERPAPI_URL = "https://serpapi.com/search";

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

function toIATA(city) {
  if (!city) return null;
  return IATA[city.toLowerCase()] || city.toUpperCase().slice(0, 3);
}

export async function searchFlights({ origin = "Delhi", destination, departDate, returnDate, travelers = 1 }) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY not set");
const url = new URL(SERPAPI_URL);
url.searchParams.set("engine", "google_flights");
url.searchParams.set("departure_id", toIATA(origin));
url.searchParams.set("arrival_id", toIATA(destination));
url.searchParams.set("outbound_date", departDate);

const isValidDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

if (isValidDate(returnDate)) {
  url.searchParams.set("return_date", returnDate);
  url.searchParams.set("type", "1");
} else {
  url.searchParams.set("type", "2");
}

url.searchParams.set("currency", "INR");
url.searchParams.set("hl", "en");
url.searchParams.set("gl", "in");
url.searchParams.set("api_key", apiKey);

console.log("[flights] URL:", url.toString());
  const res = await fetch(url);
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

  return raw
    .filter((f) => f.price && f.price > 0)
    .slice(0, 6)
    .map((f, i) => {
      const legs = f.flights || [];
      const first = legs[0] || {};
      const last = legs[legs.length - 1] || {};
      const stops = Math.max(0, legs.length - 1);
 const bookingUrl =
      f.booking_token
        ? `https://www.google.com/travel/flights/booking?hl=en&gl=in&token=${encodeURIComponent(f.booking_token)}`
        : `https://www.google.com/travel/flights?hl=en&gl=in&q=${encodeURIComponent(`flights from ${origin} to ${destination} on ${departDate}`)}`;
      return {
        id: `fl_${Date.now()}_${i}`,
        airline: first.airline || "Unknown",
        flightNumber: first.flight_number || "",
        origin: first.departure_airport?.id || origin,
        destination: last.arrival_airport?.id || destination,
        departAt: first.departure_airport?.time || "",
        arriveAt: last.arrival_airport?.time || "",
        durationMinutes: f.total_duration || 0,
        stops,
        pricePerPerson: f.price,
        totalPrice: f.price * travelers,
        currency: "INR",
        baggageIncluded: true,
        refundable: false,
        reliability: 0.85,
        bookingUrl,
        
      };
    });
}

export function scoreFlight(f) {
  return f.totalPrice * 0.6 + f.stops * 2000 + f.durationMinutes * 15;
}