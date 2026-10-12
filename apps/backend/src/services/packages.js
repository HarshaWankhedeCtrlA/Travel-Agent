import { searchFlights, scoreFlight } from "../providers/flights.js";
import { searchHotels, scoreHotel } from "../providers/hotels.js";
import { splitBudget, nightsBetween } from "./budget.js";

export async function buildPackages(trip) {
  const brief = trip.brief;
  const travelers = brief.travelers || 1;
  const nights = nightsBetween(brief.departDate, brief.returnDate);

  const budget = splitBudget(brief.budget, nights, travelers);

  const [flights, hotels] = await Promise.all([
    searchFlights({
      origin: brief.origin,
      destination: brief.destination,
      departDate: brief.departDate,
      returnDate: brief.returnDate,
      travelers,
    }),
    searchHotels({
      city: brief.destination,
      checkIn: brief.departDate,
      checkOut: brief.returnDate,
      travelers,
    }),
  ]);

  if (flights.length === 0) {
    throw new Error(
      `No flights found from ${brief.origin} to ${brief.destination} on ${brief.departDate}. Try a nearby major city.`
    );
  }
  if (hotels.length === 0) {
    throw new Error("No hotels found for this destination");
  }

  const cheapFlight = [...flights].sort((a, b) => a.totalPrice - b.totalPrice)[0];
  const cheapHotel = [...hotels].sort((a, b) => a.pricePerNight - b.pricePerNight)[0];

  const bestFlight = [...flights].sort((a, b) => scoreFlight(a) - scoreFlight(b))[0];
 const bestHotel =
  [...hotels]
    .filter((h) => h.id !== cheapHotel.id)              // ← distinct from cheapest
    .sort((a, b) => scoreHotel(b, nights) - scoreHotel(a, nights))[0] ||
  [...hotels].sort((a, b) => scoreHotel(b, nights) - scoreHotel(a, nights))[0];
 const comfFlight =
  [...flights]
    .filter((f) => f.id !== cheapFlight.id && f.id !== bestFlight.id)
    .filter((f) => f.stops === 0)
    .sort((a, b) => b.reliability - a.reliability)[0] ||
  [...flights]
    .filter((f) => f.id !== cheapFlight.id)
    .sort((a, b) => b.reliability - a.reliability)[0] ||
  [...flights].sort((a, b) => b.reliability - a.reliability)[0];

const comfHotel =
  [...hotels]
    .filter((h) => h.id !== cheapHotel.id && h.id !== bestHotel.id)
    .sort((a, b) => b.starRating - a.starRating || b.guestRating - a.guestRating)[0] ||
  [...hotels]
    .filter((h) => h.id !== cheapHotel.id)
    .sort((a, b) => b.starRating - a.starRating)[0] ||
  [...hotels].sort((a, b) => b.starRating - a.starRating)[0];
  const tiers = [
    {
      tier: "cheapest",
      label: "💰 Cheapest",
      flight: cheapFlight,
      hotel: cheapHotel,
      nights,
      reasoning: "Lowest total price across flights and stay",
      drawback:
        cheapHotel.distanceToCenterKm > 5
          ? `${cheapHotel.distanceToCenterKm} km from city center`
          : cheapFlight.stops > 0
          ? "Has a stopover"
          : "Basic amenities only",
    },
    {
      tier: "best_value",
      label: "⭐ Best value",
      flight: bestFlight,
      hotel: bestHotel,
      nights,
      reasoning: "Best mix of price, comfort, and location",
      drawback: !bestHotel.freeCancellation
        ? "No free cancellation"
        : bestFlight.stops > 0
        ? "One stopover"
        : "Standard room only",
    },
    {
      tier: "comfortable",
      label: "👑 Most comfortable",
      flight: comfFlight,
      hotel: comfHotel,
      nights,
      reasoning: "Top-rated hotel + most reliable flight",
      drawback: "Higher total cost",
    },
  ];

  // Deduplicate — ensure all 3 tiers are distinct
  const seen = new Set();
  const unique = [];
  for (const t of tiers) {
    const key = `${t.flight.id}_${t.hotel.id}`;
    if (!seen.has(key)) {
      unique.push(t);
      seen.add(key);
    }
  }
  // If we lost some to dedup, try swapping hotels to differentiate
  while (unique.length < 3) {
    const missingTier = tiers[unique.length];
    if (!missingTier) break;
    const alternativeHotel = hotels.find((h) => !unique.some((u) => u.hotel.id === h.id));
    const alternativeFlight = flights.find((f) => !unique.some((u) => u.flight.id === f.id));
    if (alternativeHotel) missingTier.hotel = alternativeHotel;
    else if (alternativeFlight) missingTier.flight = alternativeFlight;
    else break;
    const key = `${missingTier.flight.id}_${missingTier.hotel.id}`;
    if (seen.has(key)) break;
    unique.push(missingTier);
    seen.add(key);
  }

  for (const t of unique) {
    t.flightPrice = t.flight.totalPrice;
    t.hotelPrice = t.hotel.pricePerNight * nights;
    t.totalPrice = t.flightPrice + t.hotelPrice;
    t.overBudget = t.totalPrice > brief.budget;
    t.budgetFit = Math.round((t.totalPrice / brief.budget) * 100);
  }

  return { budget, tiers: unique, nights };
}

export function formatPackageMessage(tier, brief) {
  const f = tier.flight;
  const h = tier.hotel;
  const nights = tier.nights;

  return (
    `${tier.label} — ₹${tier.totalPrice.toLocaleString("en-IN")}\n\n` +
    `✈️ ${f.airline} ${f.flightNumber} • ${f.stops === 0 ? "Non-stop" : f.stops + " stop"} • ${Math.floor(f.durationMinutes / 60)}h ${f.durationMinutes % 60}m\n` +
    `    Depart ${fmtTime(f.departAt)} → Arrive ${fmtTime(f.arriveAt)}\n\n` +
    `🏨 ${h.name} • ${h.starRating}★ • ${h.guestRating.toFixed(1)}/5 (${h.reviewCount} reviews)\n` +
    `    ₹${h.pricePerNight.toLocaleString("en-IN")}/night × ${nights} nights = ₹${tier.hotelPrice.toLocaleString("en-IN")}\n` +
    `    ${h.distanceToCenterKm ?? "?"} km from center${h.breakfastIncluded ? " • Breakfast included" : ""}\n\n` +
    `💡 ${tier.reasoning}\n` +
    `⚠️ ${tier.drawback}\n` +
    `📊 ${tier.budgetFit}% of your ₹${brief.budget.toLocaleString("en-IN")} budget${tier.overBudget ? " (over)" : ""}\n\n` +
    `🔗 Book this package:\n` +
    `✈️ Flight: ${f.bookingUrl || "Ask us"}\n` +
    `🏨 Hotel: ${h.bookingUrl || "Ask us"}`
  );
}
function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}