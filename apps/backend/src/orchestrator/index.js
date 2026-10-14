import Traveler from "../models/traveler.js";
import Trip from "../models/trip.js";
import Message from "../models/message.js";
import * as wa from "../providers/whatsapp.js";
import { extractBrief } from "../llm/gateway.js";
import { askMissing } from "../llm/ask.js";
import { detectLanguage, isYes, pickTier, classify, answerQuestion } from "../llm/intent.js";
import { buildPackages, formatPackageMessage } from "../services/packages.js";
import { buildItinerary, formatDayMessage, formatSummaryMessage } from "../services/itinerary.js";
import { buildPreview, formatPreviewMessage } from "../services/preview.js";
import { searchFlights } from "../providers/flights.js";
import { initiateFee, FEE_INR } from "../services/payments.js";
import { parseCommand, runCommand } from "../services/commands.js";

// Trip flow (PRD section 4):
//   DRAFT -> BRIEF_CONFIRMED -> PREVIEW_SENT -> (fee paid) PACKAGES_SENT -> ITINERARY_SENT
// Flight and hotel searches start only after the fee is paid.

// Order matters: this is the order the bot asks the questions in.
const REQUIRED_FIELDS = ["origin", "destination", "departDate", "returnDate", "travelers", "budget"];

// Missing fields are asked in these pairs (one message, at most two questions).
const ASK_GROUPS = [
  ["origin", "destination"],
  ["departDate", "returnDate"],
  ["travelers", "budget"],
];

// A trip is "active" until it is booked or cancelled.
const TERMINAL_STATUSES = ["BOOKED", "CANCELLED"];
const MAX_ACTIVE_TRIPS = 3;

const NEW_TRIP_RE = /^(new trip|start a new trip|plan another trip|another trip|naya trip)$/i;
const PAID_CLAIM_RE = /\b(paid|ho gaya|hogaya|kar diya|kardiya|done)\b/i;
const LINK_RE = /\b(pay|payment|link|continue|proceed|aage)\b/i;
const NOT_NOW_RE = /\b(not now|later|baad mein|abhi nahi|no thanks|nahi chahiye)\b/i;
const GREETING_RE = /^(hi+|hello+|hey+|hlo|hola|namaste|namaskar)\W*$/i;

// One expensive job (packages, itinerary) per trip at a time, so a payment
// callback and a "paid" message arriving together cannot run it twice.
const busy = new Set();
function lock(tripId) {
  const key = String(tripId);
  if (busy.has(key)) return null;
  busy.add(key);
  return () => busy.delete(key);
}

// ─────────────────────────────────────────────────────────────
// Fixed bot messages. Numbers and package data stay in code; only the
// wording is translated. "hi" (Devanagari) currently uses the Hinglish set.
const TEXT = {
  en: {
    newTripLimit: (n) =>
      `You already have ${n} active trips, which is the limit. Finish or cancel one before starting another.`,
    newTripStart: `Sure, let's plan a new trip. Where do you want to go? (a city or region)`,
    briefReady: (s) => `Great! Here's your trip brief:\n\n${s}\n\nType "yes" to see your free preview.`,
    briefUpdated: (s) => `Updated. New brief:\n\n${s}\n\nType "yes" when ready.`,
    confirmNudge: `Type "yes" to see your free preview, or tell me what to change.`,
    previewing: (d) => `Perfect. Preparing a free preview for ${d}...`,
    feeOffer: (amount, url) =>
      `Like what you see? For a one-time ₹${amount} I'll send 3 packages with all-in prices, a day-by-day itinerary, and keep watching prices until you book.\n\n💳 Pay ₹${amount} (UPI / Card)\n👉 ${url}\n\nYour packages arrive here automatically after payment.\nNot ready? Just say "not now".`,
    payError: `Sorry, couldn't create the payment link right now. Say "pay" to try again in a minute.`,
    notPaidYet: `I haven't received your payment yet. If you just paid, wait a minute and say "paid" again. Say "pay" for a fresh payment link.`,
    notNow: `No problem. Your preview is saved. Say "pay" whenever you want the packages, or tell me what to change.`,
    previewNudge: `Say "pay" to get the payment link, or tell me what to change.`,
    working: `Still working on it, one moment...`,
    searching: (d) => `Payment confirmed. Searching flights and hotels for ${d}...`,
    // Before any fee: no flights on this route, so no payment is asked
    noFlightsPreview: (o, d, date) =>
      `I couldn't find any flights from ${o} to ${d} on ${date}, so I haven't asked for any payment.\n\nI plan flights + hotels only. For a short trip between nearby cities, a train or cab is usually easier. Tell me a different city or date, or type "new trip".`,
    // After the fee: nothing is lost, the traveler can change the details
    noFlights: (o, d, date) =>
      `I couldn't find any flights from ${o} to ${d} on ${date}.\n\nYour fee is safe and stays valid for this trip. Tell me a different city or date and I'll search again at no extra cost. For a refund, type HELP.`,
    packagesError: `Sorry, couldn't fetch packages right now. Your fee is safe. Say "yes" in a minute and I'll try again.`,
    checkError: `Sorry, I can't check flights right now, so I haven't asked for any payment. Please say "yes" again in a minute.`,
    paidNudge: `Your fee is paid. Say "yes" to search again, or tell me what to change (city or dates).`,
    pickPrompt: (n) =>
      `Those are your ${n} options.\n\nReply with "cheapest", "best value", or "comfortable" and I'll build your itinerary.`,
    pickNudge: `Reply with "cheapest", "best value", or "comfortable" to pick one.`,
    noOption: `Hmm, I don't have that option. Try "cheapest", "best value", or "comfortable".`,
    picked: (label) => `Great choice! You picked ${label}.`,
    building: (d) => `📍 Building your ${d} itinerary...`,
    itineraryError: `Sorry, I couldn't build the itinerary right now. Send your pick again in a minute.`,
    itineraryEnd: `Want to change anything? Type "new trip" to plan another.`,
    llmDown: `Sorry, I'm having trouble understanding messages right now. Please try again in a minute.`,
    laterDone: (d) => `Your itinerary for ${d} has already been sent. To plan another trip, type "new trip".`,
    laterProgress: (d) => `Your trip to ${d} is in progress. To plan another trip, type "new trip".`,
    // First message: who we are, what we do, what it costs (PRD section 11 F1, section 13)
    intro: (withAsk) =>
      `Hi! I'm an AI travel assistant on WhatsApp.\n\n` +
      `Tell me where you want to go and I'll plan the trip: a free preview first, then 3 packages with all-in prices and a day-by-day itinerary.\n\n` +
      `Planning costs a one-time ₹${FEE_INR} per trip, and you see the free preview before paying. Type HELP any time, or STOP to stop messages.` +
      (process.env.TERMS_URL ? `\n\nBy continuing you agree to our terms and privacy policy: ${process.env.TERMS_URL}` : "") +
      (withAsk ? `\n\nWhere do you want to go?` : ""),
    sensitiveWarn: `Please don't share passport, card, Aadhaar or OTP details in this chat. I have not saved it, and I don't need it. Please delete that message from this chat. You enter identity and payment details only on the secure page when you book.`,
  },
  hinglish: {
    newTripLimit: (n) =>
      `Aapke paas already ${n} active trips hain, ye limit hai. Naya trip shuru karne se pehle ek ko poora ya cancel karo.`,
    newTripStart: `Chalo, naya trip plan karte hain. Kahan jaana chahte ho? (city ya region)`,
    briefReady: (s) => `Badhiya! Ye raha aapka trip brief:\n\n${s}\n\nFree preview dekhne ke liye "yes" likho.`,
    briefUpdated: (s) => `Update ho gaya. Naya brief:\n\n${s}\n\nTaiyaar ho to "yes" likho.`,
    confirmNudge: `Free preview dekhne ke liye "yes" likho, ya bolo kya change karna hai.`,
    previewing: (d) => `Theek hai. ${d} ka free preview bana raha hoon...`,
    feeOffer: (amount, url) =>
      `Pasand aaya? One-time ₹${amount} mein main 3 packages (all-in prices ke saath), din-ba-din itinerary bhejunga, aur booking tak prices par nazar rakhunga.\n\n💳 ₹${amount} pay karo (UPI / Card)\n👉 ${url}\n\nPayment ke baad packages yahin apne aap aa jayenge.\nAbhi ready nahi? Bas "not now" likho.`,
    payError: `Sorry, abhi payment link nahi ban paya. Ek minute baad "pay" likho.`,
    notPaidYet: `Abhi tak aapka payment nahi mila. Abhi pay kiya hai to ek minute ruk kar dobara "paid" likho. Naya link chahiye to "pay" likho.`,
    notNow: `Koi baat nahi. Aapka preview saved hai. Packages chahiye to kabhi bhi "pay" likho, ya bolo kya change karna hai.`,
    previewNudge: `Payment link ke liye "pay" likho, ya bolo kya change karna hai.`,
    working: `Abhi kaam chal raha hai, thoda ruko...`,
    searching: (d) => `Payment mil gaya. ${d} ke liye flights aur hotels dhoondh raha hoon...`,
    noFlightsPreview: (o, d, date) =>
      `${o} se ${d} ke liye ${date} ko mujhe koi flight nahi mili, isliye maine payment nahi maangi.\n\nMain sirf flights + hotels plan karta hoon. Paas ke shehron ke beech train ya cab aam taur par aasaan hoti hai. Koi aur city ya date batao, ya "new trip" likho.`,
    noFlights: (o, d, date) =>
      `${o} se ${d} ke liye ${date} ko mujhe koi flight nahi mili.\n\nAapki fee safe hai aur isi trip ke liye valid rahegi. Koi aur city ya date batao, main bina extra paise ke dobara dhoondh dunga. Refund ke liye HELP likho.`,
    packagesError: `Sorry, abhi packages nahi la paya. Aapki fee safe hai. Ek minute baad "yes" likho, main dobara koshish karunga.`,
    checkError: `Sorry, abhi flights check nahi kar pa raha, isliye maine payment nahi maangi. Ek minute baad dobara "yes" likho.`,
    paidNudge: `Aapki fee ho chuki hai. Dobara dhoondhne ke liye "yes" likho, ya bolo kya change karna hai (city ya dates).`,
    pickPrompt: (n) =>
      `Ye hain aapke ${n} options.\n\n"cheapest", "best value" ya "comfortable" likho, main itinerary bana dunga.`,
    pickNudge: `Chunne ke liye "cheapest", "best value" ya "comfortable" likho.`,
    noOption: `Ye option mere paas nahi hai. "cheapest", "best value" ya "comfortable" try karo.`,
    picked: (label) => `Badhiya choice! Aapne ${label} chuna.`,
    building: (d) => `📍 ${d} ki itinerary bana raha hoon...`,
    itineraryError: `Sorry, abhi itinerary nahi ban payi. Ek minute baad apna pick dobara bhejo.`,
    itineraryEnd: `Kuch change karna hai? Naya trip plan karne ke liye "new trip" likho.`,
    llmDown: `Sorry, abhi aapka message samajhne mein dikkat ho rahi hai. Ek minute baad try karo.`,
    laterDone: (d) => `${d} ki itinerary bhej di gayi hai. Naya trip plan karne ke liye "new trip" likho.`,
    laterProgress: (d) => `Aapka ${d} ka trip chal raha hai. Naya trip plan karne ke liye "new trip" likho.`,
    intro: (withAsk) =>
      `Namaste! Main WhatsApp par ek AI travel assistant hoon.\n\n` +
      `Batao kahan jaana hai, main trip plan kar dunga: pehle free preview, phir all-in prices ke saath 3 packages aur din-ba-din itinerary.\n\n` +
      `Planning ka one-time ₹${FEE_INR} per trip lagta hai, aur paise dene se pehle aap free preview dekhte ho. Kabhi bhi HELP likho, ya messages band karne ke liye STOP.` +
      (process.env.TERMS_URL ? `\n\nAage badhne ka matlab hai aap hamari terms aur privacy policy se sehmat ho: ${process.env.TERMS_URL}` : "") +
      (withAsk ? `\n\nKahan jaana chahte ho?` : ""),
    sensitiveWarn: `Kripya is chat mein passport, card, Aadhaar ya OTP ki details mat bhejo. Maine ise save nahi kiya, aur mujhe iski zaroorat bhi nahi. Wo message is chat se delete kar do. Identity aur payment details aap sirf booking ke time secure page par daalte ho.`,
  },
};

function T(lang) {
  return lang === "hinglish" || lang === "hi" ? TEXT.hinglish : TEXT.en;
}

function activeTripFilter(travelerId) {
  return { travelerId, status: { $nin: TERMINAL_STATUSES } };
}

// ─────────────────────────────────────────────────────────────
export async function handleIncoming({ from, body }) {
  const traveler = await upsertTraveler(from);

  // Remember the language the traveler writes in. Short replies like "3" give
  // no signal (null), so the saved language stays.
  const detected = detectLanguage(body);
if (detected) {
  traveler.language = detected;
  await traveler.save();
}
  const lang = traveler.language || "en";

  const cmd = parseCommand(body);

  // Opted out (STOP): stay silent, except START, which brings the traveler back
  if (traveler.optedOut && cmd !== "START") {
    await Message.create({ travelerId: traveler._id, direction: "in", body: redactSensitive(body) });
    return { reply: null, status: "OPTED_OUT" };
  }

  // Passport, card, Aadhaar or OTP in chat: warn, do not process it, keep only a redacted copy.
  // (Deleting the message from the traveler's chat needs the real WhatsApp API, Step 4.)
  if (detectSensitive(body).length > 0) {
    await Message.create({ travelerId: traveler._id, direction: "in", body: redactSensitive(body) });
    return say(null, traveler, from, T(lang).sensitiveWarn);
  }

  await Message.create({ travelerId: traveler._id, direction: "in", body });

  if (cmd) return handleCommand(cmd, traveler, from, lang);

  // First message ever: say who we are and what it costs, record that it was shown, then carry on
  if (!traveler.introduced) {
    const greetingOnly = GREETING_RE.test(body.trim());
    const introText = T(lang).intro(greetingOnly);
    traveler.introduced = true;
    traveler.consentAt = new Date();
    await traveler.save();
    await sendAndLog(from, traveler, null, introText);
    if (greetingOnly) return { reply: introText, status: "INTRO" };
  }

  if (NEW_TRIP_RE.test(body.trim())) {
    return handleNewTrip(traveler, from, lang);
  }

  let trip = await Trip.findOne(activeTripFilter(traveler._id)).sort({ updatedAt: -1 });

  if (!trip) {
    trip = await Trip.create({ travelerId: traveler._id, status: "DRAFT", brief: {} });
  }

  switch (trip.status) {
    case "DRAFT":
      return handleIntake(trip, traveler, from, body, lang);
    case "BRIEF_CONFIRMED":
      return handleBriefConfirmed(trip, traveler, from, body, lang);
    case "PREVIEW_SENT":
      return handlePreviewSent(trip, traveler, from, body, lang);
    case "PACKAGES_SENT":
      return handlePackagesSent(trip, traveler, from, body, lang);
    case "FEE_PAID": // not used by this flow; kept so an old trip is not stuck
      return sendPackages(trip, traveler, from, lang);
    default:
      return handleLaterStage(trip, traveler, from, body, lang);
  }
}

// Called by the payment route right after a payment is confirmed, so the
// packages arrive without the traveler typing anything.
export async function onPaymentConfirmed(tripId) {
  const trip = await Trip.findById(tripId);
  if (!trip || !trip.feePaid || trip.status !== "PREVIEW_SENT") return;

  const traveler = await Traveler.findById(trip.travelerId);
  if (!traveler?.phone || traveler.optedOut) return;

  await sendPackages(trip, traveler, traveler.phone, traveler.language || "en");
}

// ─────────────────────────────────────────────────────────────
async function handleNewTrip(traveler, from, lang) {
  const tx = T(lang);
  const activeCount = await Trip.countDocuments(activeTripFilter(traveler._id));

  if (activeCount >= MAX_ACTIVE_TRIPS) {
    const latest = await Trip.findOne(activeTripFilter(traveler._id)).sort({ updatedAt: -1 });
    return say(latest, traveler, from, tx.newTripLimit(MAX_ACTIVE_TRIPS));
  }

  const trip = await Trip.create({ travelerId: traveler._id, status: "DRAFT", brief: {} });
  return say(trip, traveler, from, tx.newTripStart);
}

// ─────────────────────────────────────────────────────────────
async function handleIntake(trip, traveler, from, body, lang) {
  const tx = T(lang);
  const expect = trip.brief._asked;
  const extracted = await tryExtract(body, { expect, brief: trip.brief });
  if (!extracted) return say(trip, traveler, from, tx.llmDown);

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
  trip.brief._lastUserMessage = body; // context for askMissing
  trip.markModified("brief");

  const missing = REQUIRED_FIELDS.filter((f) => !trip.brief[f]);

  if (missing.length === 0) {
    delete trip.brief._asked;
    trip.status = "BRIEF_CONFIRMED";
    await trip.save();
    return say(trip, traveler, from, tx.briefReady(briefSummary(trip.brief)));
  }

  return askNext(trip, traveler, from, lang);
}

// Ask for the next missing detail(s): a pair when they belong together.
async function askNext(trip, traveler, from, lang) {
  const missing = REQUIRED_FIELDS.filter((f) => !trip.brief[f]);
  const fields = nextQuestionFields(missing);

  const question = await askMissing(fields, trip.brief, { language: lang });

  // One field: its name. Two fields: "origin and destination" (read by the extractor as context).
  trip.brief._asked = fields.join(" and ");
  trip.markModified("brief");
  await trip.save();

  return say(trip, traveler, from, question);
}

function nextQuestionFields(missing) {
  for (const group of ASK_GROUPS) {
    const inGroup = group.filter((f) => missing.includes(f));
    if (inGroup.length) return inGroup;
  }
  return [missing[0]];
}

// ─────────────────────────────────────────────────────────────
async function handleBriefConfirmed(trip, traveler, from, body, lang) {
  const tx = T(lang);
  let yes = isYes(body);

  if (!yes) {
    const extracted = await tryExtract(body, { brief: trip.brief });
    if (!extracted) return say(trip, traveler, from, tx.llmDown);

    if (Object.keys(extracted).length > 0) {
      return applyBriefEdit(trip, traveler, from, body, lang, extracted);
    }

    // Nothing extracted: the rules could not read it, so ask the model what it means.
    const intent = await classify(body, {
      labels: ["yes", "change", "question", "other"],
      context:
        'The traveler was shown their trip brief and asked to type "yes" to see a free preview, or say what to change.',
    });

    if (intent === "yes") {
      yes = true;
    } else if (intent === "question") {
      const answer = await answerQuestion(body, { language: lang, destination: trip.brief?.destination });
      return say(trip, traveler, from, answer ? `${answer}\n\n${tx.confirmNudge}` : tx.confirmNudge);
    } else {
      return say(trip, traveler, from, tx.confirmNudge);
    }
  }

  return sendPreview(trip, traveler, from, lang);
}

// The traveler changed something in the brief (PRD section 5: a brief can be
// edited at any time). The fee, if already paid, stays valid for the same trip.
async function applyBriefEdit(trip, traveler, from, body, lang, extracted) {
  const tx = T(lang);

  trip.brief = mergeBrief(trip.brief, extracted);
  trip.brief._lastUserMessage = body;
  trip.markModified("brief");

  const missing = REQUIRED_FIELDS.filter((f) => !trip.brief[f]);
  if (missing.length > 0) {
    trip.status = "DRAFT";
    return askNext(trip, traveler, from, lang);
  }

  trip.status = "BRIEF_CONFIRMED";
  await trip.save();
  return say(trip, traveler, from, tx.briefUpdated(briefSummary(trip.brief)));
}

// ─────────────────────────────────────────────────────────────
// Free preview, then the fee link. No flight or hotel search yet.
async function sendPreview(trip, traveler, from, lang) {
  const tx = T(lang);

  // Already paid (the traveler changed the details after a search that found nothing):
  // no preview and no second fee, search again straight away
  if (trip.feePaid) {
    trip.status = "PREVIEW_SENT";
    await trip.save();
    return sendPackages(trip, traveler, from, lang);
  }

  await sendAndLog(from, traveler, trip, tx.previewing(trip.brief.destination));

  // Never ask for money for a trip that has no flights. The search is cached, so the
  // packages after payment reuse it and this check costs nothing extra.
  const b = trip.brief;
  let flightsOk = true;
  try {
    const found = await searchFlights({
      origin: b.origin,
      destination: b.destination,
      departDate: b.departDate,
      returnDate: b.returnDate,
      travelers: b.travelers || 1,
    });
    flightsOk = found.length > 0;
  } catch (err) {
    if (String(err.message).startsWith("No flights")) {
      flightsOk = false;
    } else {
      // Cannot verify (provider down): do not take a fee for something we could not check
      console.error("[preview] flight check failed:", err.message);
      return say(trip, traveler, from, tx.checkError);
    }
  }
  if (!flightsOk) {
    return say(trip, traveler, from, tx.noFlightsPreview(b.origin, b.destination, b.departDate));
  }


  let preview = null;
  try {
    preview = await buildPreview(trip);
  } catch (err) {
    console.error("[preview] failed:", err);
  }

  // Saved before the link is created, so "pay" works even if the link step fails
  trip.status = "PREVIEW_SENT";
  await trip.save();

  if (preview) await sendAndLog(from, traveler, trip, formatPreviewMessage(preview, lang));

  return sendFeeLink(trip, traveler, from, lang);
}

async function sendFeeLink(trip, traveler, from, lang) {
  const tx = T(lang);

  let fee;
  try {
    fee = await initiateFee(trip);
  } catch (err) {
    console.error("[payment] initiateFee failed:", err);
    return say(trip, traveler, from, tx.payError);
  }

  const reply = tx.feeOffer(fee.amount, fee.url);
  await sendAndLog(from, traveler, trip, reply);
  return { reply, tripId: trip._id, status: trip.status, paymentUrl: fee.url };
}

async function handlePreviewSent(trip, traveler, from, body, lang) {
  const tx = T(lang);

  // Fee already paid, but the packages have not gone out (still running, or the search found nothing)
  if (trip.feePaid) {
    if (busy.has(String(trip._id))) return say(trip, traveler, from, tx.working);
    if (isYes(body) || LINK_RE.test(body)) return sendPackages(trip, traveler, from, lang);

    // The traveler may be changing the city or dates after a failed search
    const edit = await tryExtract(body, { brief: trip.brief });
    if (!edit) return say(trip, traveler, from, tx.llmDown);
    if (Object.keys(edit).length > 0) {
      return applyBriefEdit(trip, traveler, from, body, lang, edit);
    }
    return say(trip, traveler, from, tx.paidNudge);
  }

  if (PAID_CLAIM_RE.test(body)) return say(trip, traveler, from, tx.notPaidYet);
  if (isYes(body) || LINK_RE.test(body)) return sendFeeLink(trip, traveler, from, lang);
  if (NOT_NOW_RE.test(body)) return say(trip, traveler, from, tx.notNow);

  // A change to the brief?
  const extracted = await tryExtract(body, { brief: trip.brief });
  if (!extracted) return say(trip, traveler, from, tx.llmDown);
  if (Object.keys(extracted).length > 0) {
    return applyBriefEdit(trip, traveler, from, body, lang, extracted);
  }

  const intent = await classify(body, {
    labels: ["yes", "question", "other"],
    context:
      "The traveler saw a free trip preview and a payment link for the one-time fee. They were asked to pay, or say not now, or say what to change.",
  });

  if (intent === "yes") return sendFeeLink(trip, traveler, from, lang);
  if (intent === "question") {
    const answer = await answerQuestion(body, { language: lang, destination: trip.brief?.destination });
    return say(trip, traveler, from, answer ? `${answer}\n\n${tx.previewNudge}` : tx.previewNudge);
  }
  return say(trip, traveler, from, tx.previewNudge);
}

// ─────────────────────────────────────────────────────────────
// Packages: only after the fee is paid (this is where the paid searches start).
async function sendPackages(trip, traveler, from, lang) {
  const tx = T(lang);
  const release = lock(trip._id);
  if (!release) return say(trip, traveler, from, tx.working);

  try {
    await sendAndLog(from, traveler, trip, tx.searching(trip.brief.destination));

    let result;
    try {
      result = await buildPackages(trip);
    } catch (err) {
      console.error("[packages] failed:", err);
      const noFlights = err.message && err.message.includes("No flights");
      return say(
        trip,
        traveler,
        from,
        noFlights
          ? tx.noFlights(trip.brief.origin, trip.brief.destination, trip.brief.departDate)
          : tx.packagesError
      );
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

    // Over-budget warning (numbers-heavy, kept in English)
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

    const summary = tx.pickPrompt(result.tiers.length);
    await sendAndLog(from, traveler, trip, summary);
    messages.push(summary);

    return {
      reply: messages.join("\n\n---\n\n"),
      tripId: trip._id,
      status: trip.status,
      packages: result.tiers.length,
    };
  } finally {
    release();
  }
}

// ─────────────────────────────────────────────────────────────
// The fee is already paid at this point. Picking a package builds the itinerary.
async function handlePackagesSent(trip, traveler, from, body, lang) {
  const tx = T(lang);

  let picked = pickTier(body);

  if (!picked) {
    // Rules could not read it ("sasta wala chahiye", "dusra le lo"): ask the model
    const intent = await classify(body, {
      labels: ["pick_cheapest", "pick_best_value", "pick_comfortable", "question", "other"],
      context:
        "The traveler was shown 3 trip packages in this order: 1) cheapest, 2) best value, 3) most comfortable (premium). They were asked to pick one.",
    });

    if (intent === "pick_cheapest") picked = "cheapest";
    else if (intent === "pick_best_value") picked = "best_value";
    else if (intent === "pick_comfortable") picked = "comfortable";
    else if (intent === "question") {
      const answer = await answerQuestion(body, { language: lang, destination: trip.brief?.destination });
      return say(trip, traveler, from, answer ? `${answer}\n\n${tx.pickNudge}` : tx.pickNudge);
    }
  }

  if (!picked) return say(trip, traveler, from, tx.pickNudge);

  const chosen = (trip.packages || []).find((p) => p.tier === picked);
  if (!chosen) return say(trip, traveler, from, tx.noOption);

  trip.chosenTier = picked;
  await trip.save();

  await sendAndLog(from, traveler, trip, tx.picked(chosen.label));
  return sendItinerary(trip, traveler, from, lang);
}

// ─────────────────────────────────────────────────────────────
async function sendItinerary(trip, traveler, from, lang) {
  const tx = T(lang);
  const release = lock(trip._id);
  if (!release) return say(trip, traveler, from, tx.working);

  try {
    await sendAndLog(from, traveler, trip, tx.building(trip.brief.destination));

    let itinerary;
    try {
      itinerary = await buildItinerary(trip);
    } catch (err) {
      console.error("[itinerary] failed:", err);
      return say(trip, traveler, from, tx.itineraryError);
    }

    trip.itinerary = itinerary;
    trip.status = "ITINERARY_SENT";
    trip.markModified("itinerary");
    await trip.save();

    for (const day of itinerary.days) {
      await sendAndLog(from, traveler, trip, formatDayMessage(day, trip.brief));
    }

    const summaryMsg = formatSummaryMessage(
      itinerary.summary,
      itinerary.packing,
      itinerary.weather,
      itinerary.documents
    );
    await sendAndLog(from, traveler, trip, summaryMsg);
    await sendAndLog(from, traveler, trip, tx.itineraryEnd);

    return {
      reply: "Itinerary sent",
      tripId: trip._id,
      status: trip.status,
      days: itinerary.days.length,
    };
  } finally {
    release();
  }
}

// ─────────────────────────────────────────────────────────────
async function handleLaterStage(trip, traveler, from, body, lang) {
  const tx = T(lang);
  const dest = trip.brief?.destination || "your destination";
  const footer = trip.status === "ITINERARY_SENT" ? tx.laterDone(dest) : tx.laterProgress(dest);

  // A question or a "thanks" gets a short answer first, then the footer
  const answer = await answerQuestion(body, { language: lang, destination: trip.brief?.destination });
  return say(trip, traveler, from, answer ? `${answer}\n\n${footer}` : footer);
}

// ─────────────────────────────────────────────────────────────
async function tryExtract(body, ctx) {
  try {
    return await extractBrief(body, ctx);
  } catch (err) {
    console.error(`[llm] extractBrief failed (${err.code || "error"}): ${err.message}`);
    return null;
  }
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

async function handleCommand(cmd, traveler, from, lang) {
  const { text, log } = await runCommand(cmd, traveler, lang);
  if (!log) {
    // DELETE MY DATA: the traveler's records are gone, so send without logging
    await wa.sendText(from, text);
    return { reply: text, status: "DELETED" };
  }
  return say(null, traveler, from, text);
}

// ── Sensitive data guard (PRD section 5 and 9) ───────────────
// The bot never needs these. If one shows up it is not processed, and only a
// redacted copy is stored.

const SENSITIVE_PATTERNS = [
  { kind: "otp", re: /\botp\b\D{0,15}\d{4,8}\b|\b\d{4,8}\b\D{0,15}\botp\b/i },
  { kind: "cvv", re: /\bcvv\b\D{0,10}\d{3,4}\b/i },
  { kind: "upi_pin", re: /\bupi\s*pin\b\D{0,10}\d{4,6}\b/i },
  {
    kind: "aadhaar",
    re: /\b[2-9]\d{3}[\s-]\d{4}[\s-]\d{4}\b|\b(?:aadhaar|aadhar|uidai)\b\D{0,15}\d{12}\b/i,
  },
  {
    kind: "passport",
    re: /\b[A-PR-WY][1-9]\d{6}\b|\bpassport\b[^A-Za-z0-9]{0,20}(?=[A-Z0-9]*\d)[A-Z0-9]{7,9}\b/i,
  },
];

const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;

function luhnOk(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function isCardNumber(match) {
  const digits = match.replace(/\D/g, "");
  return digits.length >= 13 && digits.length <= 19 && luhnOk(digits);
}

function detectSensitive(text) {
  const t = String(text || "");
  const kinds = SENSITIVE_PATTERNS.filter(({ re }) => re.test(t)).map(({ kind }) => kind);
  for (const m of t.matchAll(CARD_RE)) {
    if (isCardNumber(m[0])) {
      kinds.push("card");
      break;
    }
  }
  return kinds;
}

function redactSensitive(text) {
  let out = String(text || "").replace(CARD_RE, (m) => (isCardNumber(m) ? "[removed]" : m));
  for (const { re } of SENSITIVE_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags + "g"), "[removed]");
  }
  return out;
}

// Send one message and return the standard result object.
async function say(trip, traveler, from, text) {
  await sendAndLog(from, traveler, trip, text);
  return { reply: text, tripId: trip?._id, status: trip?.status };
}