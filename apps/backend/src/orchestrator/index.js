import Traveler from "../models/traveler.js";
import Trip from "../models/trip.js";
import Message from "../models/message.js";
import * as wa from "../providers/whatsapp.js";
import { extractBrief } from "../llm/gateway.js";
import { buildPackages, formatPackageMessage } from "../services/packages.js";
import { buildItinerary, formatDayMessage, formatSummaryMessage } from "../services/itinerary.js";
import { initiateFee, FEE_INR } from "../services/payments.js";
import { askMissing } from "../llm/ask.js";
// Order matters: this is the order the bot asks the questions in.
const REQUIRED_FIELDS = ["origin", "destination", "departDate", "returnDate", "travelers", "budget"];

// A trip is "active" until it is booked or cancelled.
const TERMINAL_STATUSES = ["BOOKED", "CANCELLED"];
const MAX_ACTIVE_TRIPS = 3;

const NEW_TRIP_RE = /^(new trip|start a new trip|plan another trip|another trip)$/i;

const YES_WORDS = [
  "yes", "y", "yeah", "yep", "ok", "okay", "sure", "haan",
  "show me", "go ahead", "show packages",
];

function isYes(text) {
  const n = text.trim().toLowerCase();
  return YES_WORDS.some((w) => n === w || n.startsWith(w + " "));
}

function activeTripFilter(travelerId) {
  return { travelerId, status: { $nin: TERMINAL_STATUSES } };
}

export async function handleIncoming({ from, body }) {
  const traveler = await upsertTraveler(from);
  await Message.create({ travelerId: traveler._id, direction: "in", body });

  if (NEW_TRIP_RE.test(body.trim())) {
    return handleNewTrip(traveler, from);
  }

  let trip = await Trip.findOne(activeTripFilter(traveler._id)).sort({ updatedAt: -1 });

  if (!trip) {
    trip = await Trip.create({ travelerId: traveler._id, status: "DRAFT", brief: {} });
  }

  switch (trip.status) {
    case "DRAFT":
      return handleIntake(trip, traveler, from, body);
    case "BRIEF_CONFIRMED":
      return handleBriefConfirmed(trip, traveler, from, body);
    case "PACKAGES_SENT":
      return handlePackagesSent(trip, traveler, from, body);
       case "FEE_PAID":
    return handleFeePaid(trip, traveler, from, body);
    default:
      return handleLaterStage(trip, traveler, from);
  }
}

// ─────────────────────────────────────────────────────────────
async function handleNewTrip(traveler, from) {
  const activeCount = await Trip.countDocuments(activeTripFilter(traveler._id));

  if (activeCount >= MAX_ACTIVE_TRIPS) {
    const latest = await Trip.findOne(activeTripFilter(traveler._id)).sort({ updatedAt: -1 });
    const reply =
      `You already have ${MAX_ACTIVE_TRIPS} active trips, which is the limit. ` +
      `Finish or cancel one before starting another.`;
    await sendAndLog(from, traveler, latest, reply);
    return { reply, tripId: latest?._id, status: latest?.status };
  }

  const trip = await Trip.create({ travelerId: traveler._id, status: "DRAFT", brief: {} });
  const reply = `Sure, let's plan a new trip. Where do you want to go? (a city or region)`;
  await sendAndLog(from, traveler, trip, reply);
  return { reply, tripId: trip._id, status: trip.status };
}

// ─────────────────────────────────────────────────────────────
async function handleIntake(trip, traveler, from, body) {
  const expect = trip.brief._asked;
  const extracted = await tryExtract(body, { expect, brief: trip.brief });
  if (!extracted) return replyLlmDown(trip, traveler, from);

  // Regex backup: "X to Y" / "X se Y" pattern for origin/destination
  const routeMatch = body.match(/\b([A-Za-z]+)\s+(?:to|se)\s+([A-Za-z]+)\b/i);
  if (routeMatch) {
    const [, a, b] = routeMatch;
    const known = [
      "delhi", "mumbai", "pune", "goa", "bangalore", "bengaluru",
      "chennai", "hyderabad", "kolkata", "jaipur", "manali",
      "shimla", "udaipur", "kochi", "kerala", "bali", "dubai",
    ];
    if (known.includes(a.toLowerCase()) && !extracted.origin) {
      extracted.origin = a[0].toUpperCase() + a.slice(1).toLowerCase();
    }
    if (known.includes(b.toLowerCase()) && !extracted.destination) {
      extracted.destination = b[0].toUpperCase() + b.slice(1).toLowerCase();
    }
  }

  trip.brief = mergeBrief(trip.brief, extracted);
  trip.brief._lastUserMessage = body;    // ← for LLM context
  trip.markModified("brief");

  const missing = REQUIRED_FIELDS.filter((f) => !trip.brief[f]);

  if (missing.length === 0) {
    delete trip.brief._asked;
    trip.status = "BRIEF_CONFIRMED";
    await trip.save();

    const reply =
      `Great! Here's your trip brief:\n\n` +
      `${briefSummary(trip.brief)}\n\n` +
      `Type "yes" to see 3 package options.`;

    await sendAndLog(from, traveler, trip, reply);
    return { reply, tripId: trip._id, status: trip.status };
  }

  const nextField = missing[0];
const question = await askMissing(nextField, trip.brief);
trip.brief._asked = nextField;
  trip.markModified("brief");
  await trip.save();
  await sendAndLog(from, traveler, trip, question);
  return { reply: question, tripId: trip._id, status: trip.status };
}

// ─────────────────────────────────────────────────────────────
async function handleBriefConfirmed(trip, traveler, from, body) {
  if (!isYes(body)) {
    const extracted = await tryExtract(body, { brief: trip.brief });
    if (!extracted) return replyLlmDown(trip, traveler, from);

    if (Object.keys(extracted).length > 0) {
      trip.brief = mergeBrief(trip.brief, extracted);
      trip.brief._lastUserMessage = body;    // ← for LLM context
      trip.markModified("brief");
      const missing = REQUIRED_FIELDS.filter((f) => !trip.brief[f]);
      if (missing.length > 0) {
        trip.status = "DRAFT";
        trip.brief._asked = missing[0];
        await trip.save();
        const question = await askMissing(missing[0], trip.brief);
        await sendAndLog(from, traveler, trip, question);
        return { reply: question, tripId: trip._id, status: trip.status };
      }

      await trip.save();
      const reply =
        `Updated. New brief:\n\n` +
        `${briefSummary(trip.brief)}\n\n` +
        `Type "yes" when ready.`;
      await sendAndLog(from, traveler, trip, reply);
      return { reply, tripId: trip._id, status: trip.status };
    }

    const reply = `Type "yes" to see 3 package options, or tell me what to change.`;
    await sendAndLog(from, traveler, trip, reply);
    return { reply, tripId: trip._id, status: trip.status };
  }

  // Build packages
  await sendAndLog(from, traveler, trip, `Perfect. Searching flights and hotels for ${trip.brief.destination}...`);

  let result;
  try {
    result = await buildPackages(trip);
  } catch (err) {
    console.error("[packages] failed:", err);
    const reply = err.message && err.message.includes("No flights")
      ? `No flights found from ${trip.brief.origin} to ${trip.brief.destination} on ${trip.brief.departDate}.\n\nTry a nearby major city, or change your dates. Reply "new trip" to start over.`
      : `Sorry, couldn't fetch packages right now. Try again in a minute.`;
    await sendAndLog(from, traveler, trip, reply);
    return { reply, tripId: trip._id, status: trip.status };
  }

  // Save
  trip.packages = result.tiers.map((t) => ({
    tier: t.tier,
    label: t.label,
    flight: t.flight,
    hotel: t.hotel,
    totalPrice: t.totalPrice,
    reasoning: t.reasoning,
    drawback: t.drawback,
  }));
  trip.status = "PACKAGES_SENT";
  trip.markModified("packages");
  await trip.save();

  // Over-budget warning
  const cheapest = result.tiers[0];
  if (cheapest && cheapest.overBudget) {
    const over = cheapest.totalPrice - trip.brief.budget;
    const pct = Math.round((over / trip.brief.budget) * 100);
    const warning =
      `⚠️ Heads up — even the cheapest option is ₹${over.toLocaleString("en-IN")} over your ₹${trip.brief.budget.toLocaleString("en-IN")} budget (${pct}% over).\n\n` +
      `Ways to fit:\n` +
      `• Fewer nights (${result.nights} → ${Math.max(1, result.nights - 1)})\n` +
      `• Shift dates by a few days\n` +
      `• Fly from a bigger city\n` +
      `• Increase budget to ₹${Math.ceil(cheapest.totalPrice / 1000) * 1000}\n\n` +
      `Showing the options anyway:`;
    await sendAndLog(from, traveler, trip, warning);
  }

  // Send each package
  const messages = [];
  for (const tier of result.tiers) {
    const text = formatPackageMessage(tier, trip.brief);
    await sendAndLog(from, traveler, trip, text);
    messages.push(text);
  }

  const summary = `Those are your ${result.tiers.length} options.\n\nReply with "cheapest", "best value", or "comfortable" to pick one.`;
  await sendAndLog(from, traveler, trip, summary);
  messages.push(summary);

  return {
    reply: messages.join("\n\n---\n\n"),
    tripId: trip._id,
    status: trip.status,
    packages: result.tiers.length,
  };
}

async function handlePackagesSent(trip, traveler, from, body) {
  const n = body.trim().toLowerCase();
if (trip.feePaid) {
  // Already paid → build itinerary
  return handleFeePaid(trip, traveler, from, body);
}
  const picked =
    n.includes("cheap") ? "cheapest"
    : n.includes("comfort") || n.includes("premium") ? "comfortable"
    : n.includes("value") || n.includes("best") ? "best_value"
    : null;

  if (!picked) {
    const reply = `Reply with "cheapest", "best value", or "comfortable" to pick one.`;
    await sendAndLog(from, traveler, trip, reply);
    return { reply, tripId: trip._id, status: trip.status };
  }

  const chosen = (trip.packages || []).find((p) => p.tier === picked);
  if (!chosen) {
    const reply = `Hmm, I don't have that option. Try "cheapest", "best value", or "comfortable".`;
    await sendAndLog(from, traveler, trip, reply);
    return { reply, tripId: trip._id, status: trip.status };
  }

  trip.chosenTier = picked;
  await trip.save();

  // If fee not paid yet → ask for payment first
  if (!trip.feePaid) {
    const { url, amount } = await initiateFee(trip);

    const payMsg =
      `Great choice! You picked ${chosen.label}.\n\n` +
      `✈️ ${chosen.flight.airline} ${chosen.flight.flightNumber}\n` +
      `🏨 ${chosen.hotel.name}\n` +
      `💰 Total: ₹${chosen.totalPrice.toLocaleString("en-IN")}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `To unlock your day-by-day itinerary + price watching,\n` +
      `pay the one-time fee:\n\n` +
      `💳 ₹${amount} (UPI / Card)\n` +
      `👉 ${url}\n\n` +
      `After payment, reply "paid" and I'll build your itinerary.`;

    await sendAndLog(from, traveler, trip, payMsg);
    return {
      reply: payMsg,
      tripId: trip._id,
      status: trip.status,
      paymentUrl: url,
    };
  }

  // Fee paid → build itinerary
  await sendAndLog(from, traveler, trip, `📍 Building your ${trip.brief.destination} itinerary...`);

  let itinerary;
  try {
    itinerary = await buildItinerary(trip);
  } catch (err) {
    console.error("[itinerary] failed:", err);
    const reply = `Sorry, I couldn't build the itinerary right now. Try again in a minute.`;
    await sendAndLog(from, traveler, trip, reply);
    return { reply, tripId: trip._id, status: trip.status };
  }

  trip.itinerary = itinerary;
  trip.status = "ITINERARY_SENT";
  trip.markModified("itinerary");
  await trip.save();

  for (const day of itinerary.days) {
    const text = formatDayMessage(day, trip.brief);
    await sendAndLog(from, traveler, trip, text);
  }

  const summaryMsg = formatSummaryMessage(
    itinerary.summary,
    itinerary.packing,
    itinerary.weather,
    itinerary.documents
  );
  await sendAndLog(from, traveler, trip, summaryMsg);

  const endMsg = `Want to change anything? Type "new trip" to plan another.`;
  await sendAndLog(from, traveler, trip, endMsg);

  return {
    reply: "Itinerary sent",
    tripId: trip._id,
    status: trip.status,
    days: itinerary.days.length,
  };
}

async function handleFeePaid(trip, traveler, from, body) {
  // Build itinerary immediately
  await sendAndLog(from, traveler, trip, `📍 Building your ${trip.brief.destination} itinerary...`);

  let itinerary;
  try {
    itinerary = await buildItinerary(trip);
  } catch (err) {
    console.error("[itinerary] failed:", err);
    const reply = `Sorry, I couldn't build the itinerary right now. Try again in a minute.`;
    await sendAndLog(from, traveler, trip, reply);
    return { reply, tripId: trip._id, status: trip.status };
  }

  trip.itinerary = itinerary;
  trip.status = "ITINERARY_SENT";
  trip.markModified("itinerary");
  await trip.save();

  for (const day of itinerary.days) {
    const text = formatDayMessage(day, trip.brief);
    await sendAndLog(from, traveler, trip, text);
  }

  const summaryMsg = formatSummaryMessage(
    itinerary.summary,
    itinerary.packing,
    itinerary.weather,
    itinerary.documents
  );
  await sendAndLog(from, traveler, trip, summaryMsg);

  const endMsg = `Want to change anything? Type "new trip" to plan another.`;
  await sendAndLog(from, traveler, trip, endMsg);

  return {
    reply: "Itinerary sent",
    tripId: trip._id,
    status: trip.status,
    days: itinerary.days.length,
  };
}

// ─────────────────────────────────────────────────────────────
async function handleLaterStage(trip, traveler, from) {
  const chosen = (trip.packages || []).find((p) => p.tier === trip.chosenTier);
  const reply =
    (chosen
      ? `Your ${chosen.label} package for ${trip.brief?.destination || "your trip"} is saved. `
      : `Your trip to ${trip.brief?.destination || "your destination"} is in progress. `) +
    `The itinerary and price alerts are coming soon.\n\n` +
    `To plan another trip, type "new trip".`;

  await sendAndLog(from, traveler, trip, reply);
  return { reply, tripId: trip._id, status: trip.status };
}

// ─────────────────────────────────────────────────────────────
function questionFor(field, brief) {
  switch (field) {
    case "origin": return "Which city are you travelling from?";
    case "destination": return "Where do you want to go? (a city or region)";
    case "departDate":
      return brief.destination
        ? `When do you want to travel to ${brief.destination}? (e.g., "20 Dec" or "20 to 27 Dec")`
        : "When do you want to travel?";
    case "returnDate":
      return `How many nights will you stay, or when do you come back? (e.g., "5 nights" or "27 Dec")`;
    case "travelers": return "How many people are traveling?";
    case "budget":    return "What's your total budget in rupees? (e.g., 30000 or 30k)";
    default:          return "Tell me more about your trip.";
  }
}

async function tryExtract(body, ctx) {
  try {
    return await extractBrief(body, ctx);
  } catch (err) {
    console.error(`[llm] extractBrief failed (${err.code || "error"}): ${err.message}`);
    return null;
  }
}

async function replyLlmDown(trip, traveler, from) {
  const reply = `Sorry, I'm having trouble understanding messages right now. Please try again in a minute.`;
  await sendAndLog(from, traveler, trip, reply);
  return { reply, tripId: trip._id, status: trip.status };
}

function mergeBrief(brief, extracted) {
  const merged = { ...brief, ...extracted };
  if (
    extracted.departDate &&
    !extracted.returnDate &&
    extracted.departDate !== brief.departDate
  ) {
    delete merged.returnDate;
  }
  return merged;
}

function briefSummary(b) {
  const lines = [
    `From: ${b.origin}`,
    `To: ${b.destination}`,
    `Dates: ${b.departDate} → ${b.returnDate}`,
    `Travelers: ${b.travelers}`,
    `Budget: ₹${Number(b.budget).toLocaleString("en-IN")}`,
  ];
  if (b.datesApproximate) {
    lines.push(`\nI guessed the dates from the month. Send exact dates like "20 to 27 Dec" any time.`);
  }
  return lines.join("\n");
}

async function upsertTraveler(phone) {
  let traveler = await Traveler.findOne({ phone });
  if (!traveler) traveler = await Traveler.create({ phone });
  return traveler;
}

async function sendAndLog(from, traveler, trip, body) {
  await wa.sendText(from, body);
  await Message.create({
    travelerId: traveler._id,
    tripId: trip?._id,
    direction: "out",
    body,
  });
}