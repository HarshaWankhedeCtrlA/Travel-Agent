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
import crypto from "node:crypto";

// Trip flow (PRD section 4):
//   DRAFT -> BRIEF_CONFIRMED -> PREVIEW_SENT -> (fee paid) PACKAGES_SENT -> ITINERARY_SENT
// Flight and hotel searches start only after the fee is paid.

const REQUIRED_FIELDS = ["origin", "destination", "departDate", "returnDate", "travelers", "budget"];

const ASK_GROUPS = [
  ["origin", "destination"],
  ["departDate", "returnDate"],
  ["travelers", "budget"],
];

const TERMINAL_STATUSES = ["BOOKED", "CANCELLED"];
const MAX_ACTIVE_TRIPS = 3;

const NEW_TRIP_RE = /^(new trip|start a new trip|plan another trip|another trip|naya trip)$/i;
const PAID_CLAIM_RE = /\b(paid|ho gaya|hogaya|kar diya|kardiya|done)\b/i;
const LINK_RE = /\b(pay|payment|link|continue|proceed|aage)\b/i;
const NOT_NOW_RE = /\b(not now|later|baad mein|abhi nahi|no thanks|nahi chahiye)\b/i;
const GREETING_RE = /^(hi+|hello+|hey+|hlo|hola|namaste|namaskar|yo|sup|good\s+(morning|afternoon|evening|night))\W*$/i;

const busy = new Set();
function lock(tripId) {
  const key = String(tripId);
  if (busy.has(key)) return null;
  busy.add(key);
  return () => busy.delete(key);
}

// ─────────────────────────────────────────────────────────────
// Fixed bot messages. Numbers and package data stay in code; only the
// wording is translated.

const TEXT = {
  en: {
    newTripLimit: (n) =>
      `You already have ${n} active trips, which is the limit. Finish or cancel one before starting another.`,
    newTripStart: `Sure, let's plan a new trip 👋\n\nWhere do you want to go? (a city or region)`,
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
    noFlightsPreview: (o, d, date) =>
      `I couldn't find any flights from ${o} to ${d} on ${date}, so I haven't asked for any payment.\n\nI plan flights + hotels only. For a short trip between nearby cities, a train or cab is usually easier. Tell me a different city or date, or type "new trip".`,
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
    laterDone: (d) =>
      `Your itinerary for ${d} has already been sent 👋\n\nWant to plan another trip? Just tell me where and when, or type "new trip".`,
    laterProgress: (d) =>
      `Your trip to ${d} is in progress 👋\n\nTell me what you'd like to change, or type "new trip" to start fresh.`,
    intro: (withAsk) =>
      `Hi! I'm your AI travel planner 👋\n\n` +
      `I'll help you plan a trip: a free preview, 3 packages with all-in prices, and a day-by-day itinerary.\n\n` +
      `The planning is a one-time ₹${FEE_INR} per trip, and you see the free preview before paying. Type HELP any time, or STOP to stop messages.` +
      (process.env.TERMS_URL ? `\n\nBy continuing you agree to our terms: ${process.env.TERMS_URL}` : "") +
      (withAsk ? `\n\nWhere would you like to go?` : ""),
    greetingReply: `Hi there! 👋 How can I help you today?\n\nI'm your AI travel planner. You can tell me:\n• "Delhi to Goa in December, 40k, 2 people"\n• "Somewhere warm next month"\n• Or type HELP to see what I can do.`,
    greetingWithTrip: (trip) => {
      const d = trip.brief?.destination || "your trip";
      if (trip.status === "BRIEF_CONFIRMED") {
        return `Hi! 👋 Your ${d} trip is ready for review. Type "yes" to see the free preview, or tell me what to change.`;
      }
      if (trip.status === "PREVIEW_SENT") {
        return `Hi! 👋 Your ${d} preview was sent. Say "pay" for the payment link, or tell me what to change.`;
      }
      if (trip.status === "PACKAGES_SENT") {
        return `Hi! 👋 I sent your 3 ${d} packages. Reply "cheapest", "best value", or "comfortable" to pick one.`;
      }
      if (trip.status === "ITINERARY_SENT") {
        return `Hi! 👋 Your ${d} itinerary is ready. Want to plan another trip? Just say where and when.`;
      }
      return `Hi! 👋 You have a trip in progress. Tell me what you'd like to do.`;
    },
    helpNudge: `I'm here to help! 👋 Tell me about your trip — where you want to go, when, and your budget.\n\nFor example:\n• "Delhi to Goa in December, 40k, 2 people"\n• "Somewhere warm next month"\n\nOr type HELP for what I can do.`,
    sensitiveWarn: `Please don't share passport, card, Aadhaar or OTP details in this chat. I have not saved it, and I don't need it. Please delete that message from this chat. You enter identity and payment details only on the secure page when you book.`,
  },
  hinglish: {
    newTripLimit: (n) =>
      `Aapke paas already ${n} active trips hain, ye limit hai. Naya trip shuru karne se pehle ek ko poora ya cancel karo.`,
    newTripStart: `Chalo, naya trip plan karte hain 👋\n\nKahan jaana chahte ho? (city ya region)`,
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
    laterDone: (d) =>
      `${d} ki itinerary bhej di gayi hai 👋\n\nNaya trip plan karna hai? Bas batao kahan aur kab, ya "new trip" likho.`,
    laterProgress: (d) =>
      `Aapka ${d} ka trip chal raha hai 👋\n\nBolo kya change karna hai, ya "new trip" likho naye sire se shuru karne ke liye.`,
    intro: (withAsk) =>
      `Namaste! Main aapka AI travel planner hoon 👋\n\n` +
      `Main aapka trip plan karunga: pehle free preview, phir all-in prices ke saath 3 packages aur din-ba-din itinerary.\n\n` +
      `Planning ka one-time ₹${FEE_INR} per trip lagta hai, aur paise dene se pehle aap free preview dekhte ho. Kabhi bhi HELP likho, ya STOP for messages band.` +
      (process.env.TERMS_URL ? `\n\nAage badhne ka matlab hai aap hamari terms se sehmat ho: ${process.env.TERMS_URL}` : "") +
      (withAsk ? `\n\nKahan jaana chahte ho?` : ""),
    greetingReply: `Namaste! 👋 Main aapki kaise help kar sakta hoon?\n\nMain aapka AI travel planner hoon. Aap mujhe bata sakte ho:\n• "Delhi se Goa December me, 40k, 2 log"\n• "Koi garm jagah next month"\n• Ya HELP likho yeh dekhne ke liye ki main kya kar sakta hoon.`,
    greetingWithTrip: (trip) => {
      const d = trip.brief?.destination || "your trip";
      if (trip.status === "BRIEF_CONFIRMED") {
        return `Namaste! 👋 Aapka ${d} trip review ke liye ready hai. Free preview ke liye "yes" likho, ya bolo kya change karna hai.`;
      }
      if (trip.status === "PREVIEW_SENT") {
        return `Namaste! 👋 Aapka ${d} preview bheja gaya. Payment link ke liye "pay" likho, ya bolo kya change karna hai.`;
      }
      if (trip.status === "PACKAGES_SENT") {
        return `Namaste! 👋 Aapke 3 ${d} packages bheje. Pick karne ke liye "cheapest", "best value" ya "comfortable" likho.`;
      }
      if (trip.status === "ITINERARY_SENT") {
        return `Namaste! 👋 Aapki ${d} itinerary ready hai. Naya trip plan karna hai? Bas batao kahan aur kab.`;
      }
      return `Namaste! 👋 Aapka ek trip chal raha hai. Bolo kya karna hai.`;
    },
    helpNudge: `Main help karne ke liye yahan hoon! 👋 Apne trip ke baare me batao — kahan jaana hai, kab, aur budget kitna hai.\n\nJaise:\n• "Delhi se Goa December me, 40k, 2 log"\n• "Koi garm jagah next month"\n\nYa HELP likho yeh dekhne ke liye ki main kya kar sakta hoon.`,
    sensitiveWarn: `Kripya is chat mein passport, card, Aadhaar ya OTP ki details mat bhejo. Maine ise save nahi kiya, aur mujhe iski zaroorat bhi nahi. Wo message is chat se delete kar do. Identity aur payment details aap sirf booking ke time secure page par daalte ho.`,
  },
  hi: {
    newTripLimit: (n) =>
      `आपके पास पहले से ${n} active trips हैं, यह limit है। नया trip शुरू करने से पहले एक को पूरा या cancel करें।`,
    newTripStart: `ठीक है, नया trip plan करते हैं 👋\n\nकहाँ जाना चाहते हैं? (city या region)`,
    briefReady: (s) => `बहुत बढ़िया! यह रहा आपका trip brief:\n\n${s}\n\nFree preview देखने के लिए "yes" लिखें।`,
    briefUpdated: (s) => `Update हो गया। नया brief:\n\n${s}\n\nतैयार हों तो "yes" लिखें।`,
    confirmNudge: `Free preview देखने के लिए "yes" लिखें, या बताएँ क्या बदलना है।`,
    previewing: (d) => `ठीक है। ${d} का free preview बना रहा हूँ...`,
    feeOffer: (amount, url) =>
      `पसंद आया? One-time ₹${amount} में मैं 3 packages (all-in prices के साथ), दिन-ब-दिन itinerary भेजूँगा, और booking तक prices पर नज़र रखूँगा।\n\n💳 ₹${amount} pay करें (UPI / Card)\n👉 ${url}\n\nPayment के बाद packages यहीं अपने आप आ जाएँगे।\nअभी तैयार नहीं? बस "not now" लिखें।`,
    payError: `Sorry, अभी payment link नहीं बन पाया। एक minute बाद "pay" लिखें।`,
    notPaidYet: `अभी तक आपका payment नहीं मिला। अभी pay किया है तो एक minute रुक कर दोबारा "paid" लिखें। नया link चाहिए तो "pay" लिखें।`,
    notNow: `कोई बात नहीं। आपका preview saved है। Packages चाहिए तो कभी भी "pay" लिखें, या बताएँ क्या बदलना है।`,
    previewNudge: `Payment link के लिए "pay" लिखें, या बताएँ क्या बदलना है।`,
    working: `अभी काम चल रहा है, थोड़ा रुकें...`,
    searching: (d) => `Payment मिल गया। ${d} के लिए flights और hotels खोज रहा हूँ...`,
    noFlightsPreview: (o, d, date) =>
      `${o} से ${d} के लिए ${date} को मुझे कोई flight नहीं मिली, इसलिए मैंने payment नहीं माँगी।\n\nमैं सिर्फ flights + hotels plan करता हूँ। पास के शहरों के बीच train या cab आम तौर पर आसान होती है। कोई और city या date बताएँ, या "new trip" लिखें।`,
    noFlights: (o, d, date) =>
      `${o} से ${d} के लिए ${date} को मुझे कोई flight नहीं मिली।\n\nआपकी fee safe है और इसी trip के लिए valid रहेगी। कोई और city या date बताएँ, मैं बिना extra पैसे के दोबारा खोज दूँगा। Refund के लिए HELP लिखें।`,
    packagesError: `Sorry, अभी packages नहीं ला पाया। आपकी fee safe है। एक minute बाद "yes" लिखें, मैं दोबारा कोशिश करूँगा।`,
    checkError: `Sorry, अभी flights check नहीं कर पा रहा, इसलिए मैंने payment नहीं माँगी। एक minute बाद दोबारा "yes" लिखें।`,
    paidNudge: `आपकी fee हो चुकी है। दोबारा खोजने के लिए "yes" लिखें, या बताएँ क्या बदलना है (city या dates)।`,
    pickPrompt: (n) =>
      `ये हैं आपके ${n} options।\n\n"cheapest", "best value" या "comfortable" लिखें, मैं itinerary बना दूँगा।`,
    pickNudge: `चुनने के लिए "cheapest", "best value" या "comfortable" लिखें।`,
    noOption: `यह option मेरे पास नहीं है। "cheapest", "best value" या "comfortable" try करें।`,
    picked: (label) => `बढ़िया choice! आपने ${label} चुना।`,
    building: (d) => `📍 ${d} की itinerary बना रहा हूँ...`,
    itineraryError: `Sorry, अभी itinerary नहीं बन पाई। एक minute बाद अपना pick दोबारा भेजें।`,
    itineraryEnd: `कुछ बदलना है? नया trip plan करने के लिए "new trip" लिखें।`,
    llmDown: `Sorry, अभी आपका message समझने में दिक्कत हो रही है। एक minute बाद try करें।`,
    laterDone: (d) =>
      `${d} की itinerary भेज दी गई है 👋\n\nनया trip plan करना है? बस बताएँ कहाँ और कब, या "new trip" लिखें।`,
    laterProgress: (d) =>
      `आपका ${d} का trip चल रहा है 👋\n\nबताएँ क्या बदलना है, या "new trip" लिखें नए सिरे से शुरू करने के लिए।`,
    intro: (withAsk) =>
      `नमस्ते! मैं आपका AI travel planner हूँ 👋\n\n` +
      `मैं आपका trip plan करूँगा: पहले free preview, फिर all-in prices के साथ 3 packages और दिन-ब-दिन itinerary।\n\n` +
      `Planning का one-time ₹${FEE_INR} per trip लगता है, और पैसे देने से पहले आप free preview देखते हैं। कभी भी HELP लिखें, या STOP for messages बंद।` +
      (process.env.TERMS_URL ? `\n\nआगे बढ़ने का मतलब है आप हमारी terms से सहमत हैं: ${process.env.TERMS_URL}` : "") +
      (withAsk ? `\n\nकहाँ जाना चाहते हैं?` : ""),
    greetingReply: `नमस्ते! 👋 मैं आपकी कैसे help कर सकता हूँ?\n\nमैं आपका AI travel planner हूँ। आप मुझे बता सकते हैं:\n• "Delhi से Goa December में, 40k, 2 लोग"\n• "कोई गर्म जगह next month"\n• या HELP लिखें यह देखने के लिए कि मैं क्या कर सकता हूँ।`,
    greetingWithTrip: (trip) => {
      const d = trip.brief?.destination || "your trip";
      if (trip.status === "BRIEF_CONFIRMED") {
        return `नमस्ते! 👋 आपका ${d} trip review के लिए ready है। Free preview के लिए "yes" लिखें, या बताएँ क्या बदलना है।`;
      }
      if (trip.status === "PREVIEW_SENT") {
        return `नमस्ते! 👋 आपका ${d} preview भेजा गया। Payment link के लिए "pay" लिखें, या बताएँ क्या बदलना है।`;
      }
      if (trip.status === "PACKAGES_SENT") {
        return `नमस्ते! 👋 आपके 3 ${d} packages भेजे। Pick करने के लिए "cheapest", "best value" या "comfortable" लिखें।`;
      }
      if (trip.status === "ITINERARY_SENT") {
        return `नमस्ते! 👋 आपकी ${d} itinerary ready है। नया trip plan करना है? बस बताएँ कहाँ और कब।`;
      }
      return `नमस्ते! 👋 आपका एक trip चल रहा है। बताएँ क्या करना है।`;
    },
    helpNudge: `मैं help करने के लिए यहाँ हूँ! 👋 अपने trip के बारे में बताएँ — कहाँ जाना है, कब, और budget कितना है।\n\nजैसे:\n• "Delhi से Goa December में, 40k, 2 लोग"\n• "कोई गर्म जगह next month"\n\nया HELP लिखें।`,
    sensitiveWarn: `कृपया इस chat में passport, card, Aadhaar या OTP की details न भेजें। मैंने इसे save नहीं किया, और मुझे इसकी ज़रूरत भी नहीं। वह message इस chat से delete कर दें। Identity और payment details आप सिर्फ booking के time secure page पर डालते हैं।`,
  },
};

function T(lang) {
  if (lang === "hi") return TEXT.hi;
  if (lang === "hinglish") return TEXT.hinglish;
  return TEXT.en;
}

// 🔧 FIXED: skip empty drafts so they don't hijack the "latest trip" lookup
function activeTripFilter(travelerId) {
  return {
    travelerId,
    status: { $nin: TERMINAL_STATUSES },
    $or: [
      { "brief.destination": { $exists: true, $ne: null } },
      { status: { $ne: "DRAFT" } },
    ],
  };
}

// ─────────────────────────────────────────────────────────────
export async function handleIncoming({ from, body }) {
  // 🛡️ Guard against empty/undefined bodies
  if (!from || !body || !String(body).trim()) {
    console.log("[handler] IGNORED empty inbound", { from, body });
    return { reply: null, status: "IGNORED" };
  }

  // 🔍 Log EVERY inbound, before any early returns
  console.log(`[handler] inbound from=${from} msg="${String(body).slice(0, 60)}"`);

  const traveler = await upsertTraveler(from);
  const detected = detectLanguage(body);
  if (detected) {
    traveler.language = detected;
    await traveler.save();
  }
  const lang = traveler.language || "en";

  const cmd = parseCommand(body);

  if (traveler.optedOut && cmd !== "START") {
    await Message.create({ travelerId: traveler._id, direction: "in", body: redactSensitive(body) });
    return { reply: null, status: "OPTED_OUT" };
  }

  if (detectSensitive(body).length > 0) {
    await Message.create({ travelerId: traveler._id, direction: "in", body: redactSensitive(body) });
    return say(null, traveler, from, T(lang).sensitiveWarn);
  }

  await Message.create({ travelerId: traveler._id, direction: "in", body });

  if (cmd) return handleCommand(cmd, traveler, from, lang);

  // First message ever: intro (with AI disclosure + fee)
  if (!traveler.introduced) {
    const greetingOnly = GREETING_RE.test(body.trim());
    const introText = T(lang).intro(greetingOnly);
    traveler.introduced = true;
    traveler.consentAt = new Date();
    await traveler.save();
    await sendAndLog(from, traveler, null, introText);
    if (greetingOnly) return { reply: introText, status: "INTRO" };
  }

  // Greeting from an already-introduced traveler
  if (GREETING_RE.test(body.trim())) {
    // If there's an active trip, remind them of it instead of a generic reply
    const activeTrip = await Trip.findOne(activeTripFilter(traveler._id)).sort({ updatedAt: -1 });
    if (activeTrip && activeTrip.status !== "DRAFT") {
      return say(activeTrip, traveler, from, T(lang).greetingWithTrip(activeTrip));
    }
    return say(null, traveler, from, T(lang).greetingReply);
  }

  // Gibberish / very short / no-meaning -> warm nudge
  if (isGibberish(body)) {
    return say(null, traveler, from, T(lang).helpNudge);
  }

  if (NEW_TRIP_RE.test(body.trim())) {
    return handleNewTrip(traveler, from, lang);
  }

  let trip = await Trip.findOne(activeTripFilter(traveler._id)).sort({ updatedAt: -1 });

  if (!trip) {
    trip = await Trip.create({ travelerId: traveler._id, status: "DRAFT", brief: {} });
  }

  // 🔍 Log trip context (fires only when we reach the trip-state switch)
  console.log(
    `[handler] trip=${trip._id} status=${trip.status} ` +
    `dest=${trip.brief?.destination || "?"}`
  );

  switch (trip.status) {
    case "DRAFT":
      return handleIntake(trip, traveler, from, body, lang);
    case "BRIEF_CONFIRMED":
      return handleBriefConfirmed(trip, traveler, from, body, lang);
    case "PREVIEW_SENT":
      return handlePreviewSent(trip, traveler, from, body, lang);
    case "PACKAGES_SENT":
      return handlePackagesSent(trip, traveler, from, body, lang);
    case "FEE_PAID":
      return sendPackages(trip, traveler, from, lang);
    default:
      return handleLaterStage(trip, traveler, from, body, lang);
  }
}

// Helper: too short / no-meaning message?
// Words that look short but are meaningful — don't treat as gibberish
const KNOWN_SHORT = /^(hi|hey|yo|ok|okay|k|y|n|no|yes|to|from|se|ka|ki|ke|me|in|at|on|is|are|a|an|the|haan|nahi|na|hn|hmm|hm|go|goa|delhi|mumbai|pune|1|2|3|4|5|6|7|8|9|10)$/i;

function isGibberish(text) {
  const t = String(text || "").trim();
  if (t.length === 0) return true;
  if (/^\d+$/.test(t)) return false;              // any pure number is meaningful
  if (KNOWN_SHORT.test(t)) return false;          // known short words
  if (t.length <= 1) return true;                 // single letter that's not known
  if (!/[aeiouAEIOU\u0900-\u097F0-9]/.test(t) && t.length <= 5) return true;
  return false;
}

// Called by the payment route right after a payment is confirmed.
export async function onPaymentConfirmed(tripId) {
  const trip = await Trip.findById(tripId);
  if (!trip || !trip.feePaid || trip.status !== "PREVIEW_SENT") return;

  const traveler = await Traveler.findById(trip.travelerId);
  if (!traveler?.phone || traveler.optedOut) return;

  await sendPackages(trip, traveler, traveler.phone, traveler.language || "en");
}

async function handleNewTrip(traveler, from, lang) {
  const tx = T(lang);

  // Cancel any existing non-terminal trips so the new one becomes the sole "active" candidate
  await Trip.updateMany(
    {
      travelerId: traveler._id,
      status: { $nin: TERMINAL_STATUSES },
    },
    { $set: { status: "CANCELLED" } }
  );

  const trip = await Trip.create({ travelerId: traveler._id, status: "DRAFT", brief: {} });
  return say(trip, traveler, from, tx.newTripStart);
}

// ─────────────────────────────────────────────────────────────
async function handleIntake(trip, traveler, from, body, lang) {
  const tx = T(lang);
  const expect = trip.brief._asked;
  const extracted = await tryExtract(body, { expect, brief: trip.brief });
  if (!extracted) return say(trip, traveler, from, tx.llmDown);

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
  trip.brief._lastUserMessage = body;
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

async function askNext(trip, traveler, from, lang) {
  const missing = REQUIRED_FIELDS.filter((f) => !trip.brief[f]);
  const fields = nextQuestionFields(missing);

  const question = await askMissing(fields, trip.brief, { language: lang });

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
async function sendPreview(trip, traveler, from, lang) {
  const tx = T(lang);

  if (trip.feePaid) {
    trip.status = "PREVIEW_SENT";
    await trip.save();
    return sendPackages(trip, traveler, from, lang);
  }

  await sendAndLog(from, traveler, trip, tx.previewing(trip.brief.destination));

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

  if (trip.feePaid) {
    if (busy.has(String(trip._id))) return say(trip, traveler, from, tx.working);
    if (isYes(body) || LINK_RE.test(body)) return sendPackages(trip, traveler, from, lang);

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

    trip.packages = result.tiers.map((t) => ({
      tier: t.tier,
      label: t.label,
      flight: t.flight,
      hotel: t.hotel,
      totalPrice: t.totalPrice,
      reasoning: t.reasoning,
      drawback: t.drawback,
    }));

    // F6: seed baseline so price watch has something to compare against.
    if (result.tiers[0] && !trip.baselinePrice) {
      trip.baselinePrice = result.tiers[0].totalPrice;
    }

    trip.status = "PACKAGES_SENT";
    trip.markModified("packages");
    await trip.save();

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
async function handlePackagesSent(trip, traveler, from, body, lang) {
  const tx = T(lang);

  let picked = pickTier(body);

  if (!picked) {
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

  // F6: baseline price for price watch (PRD §6)
  trip.baselinePrice = chosen.totalPrice;

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

    // Generate share token if not already set
    if (!trip.shareToken) {
      trip.shareToken = crypto.randomBytes(16).toString("hex");
      trip.shareEnabled = true;
    }

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

    // 📱 Send shareable itinerary link
    const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    if (trip.shareToken) {
      const shareUrl = `${baseUrl}/itinerary/${trip._id}?t=${trip.shareToken}`;
      await sendAndLog(from, traveler, trip, `📱 Save your full itinerary:\n${shareUrl}`);
    }

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
    await wa.sendText(from, text);
    return { reply: text, status: "DELETED" };
  }
  return say(null, traveler, from, text);
}

// ── Sensitive data guard ────────────────────────────────────

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

async function say(trip, traveler, from, text) {
  await sendAndLog(from, traveler, trip, text);
  return { reply: text, tripId: trip?._id, status: trip?.status };
}