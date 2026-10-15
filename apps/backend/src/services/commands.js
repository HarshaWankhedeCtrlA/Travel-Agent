// Always-available commands (PRD section 11): STOP, START, HELP, PAUSE, RESUME,
// STATUS, DELETE, PAUSE_WATCH, RESUME_WATCH, BOOK, WAIT.

import Traveler from "../models/traveler.js";
import Trip from "../models/trip.js";
import Message from "../models/message.js";

const TERMINAL = ["BOOKED", "CANCELLED"];

const COMMANDS = {
  STOP: ["stop", "stop all", "unsubscribe", "opt out", "optout"],
  START: ["start", "subscribe"],
  HELP: ["help", "menu", "madad"],
  BOOK: ["book", "book now", "book it", "book this", "i'll book", "ill book", "book karo"],
  WAIT: ["wait", "keep waiting", "keep watching", "not yet", "later", "wait karo"],
  PAUSE_WATCH: ["pause watch", "pause alerts", "mute alerts"],
  RESUME_WATCH: ["resume watch", "resume alerts", "unmute alerts"],
  PAUSE: ["pause"],
  RESUME: ["resume"],
  STATUS: ["status"],
  DELETE: ["delete", "delete data"],
  CONFIRM_DELETE: ["delete my data"],
  LANG_EN: ["english"],
  LANG_HINGLISH: ["hinglish"],
  LANG_HI: ["hindi", "हिंदी", "हिन्दी"],
};

export function parseCommand(text) {
  const n = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return null;
  const entries = Object.entries(COMMANDS).sort(
    (a, b) => Math.max(...b[1].map((w) => w.length)) - Math.max(...a[1].map((w) => w.length))
  );
  for (const [cmd, words] of entries) {
    if (words.includes(n)) return cmd;
  }
  return null;
}

// ── Wording ──────────────────────────────────────────────────

const TEXT = {
  en: {
    stopped: `You're opted out and I won't message you again. Send START any time to come back.`,
    started: `Welcome back! Tell me where you want to go, or type "new trip" to start a fresh plan.`,
    alreadyActive: `You're already active. Tell me where you want to go.`,
    help: (support) =>
      [
        `Here's what I can do. I'm an AI assistant.`,
        ``,
        `• Tell me where you want to go and I'll plan the trip`,
        `• "new trip": start another trip`,
        `• STATUS: see your trips`,
        `• PAUSE / RESUME: stop or restart updates for your latest trip`,
        `• PAUSE WATCH / RESUME WATCH: stop or restart price alerts only`,
        `• BOOK: get booking links for your latest trip`,
        `• STOP: stop all messages (START to come back)`,
        `• DELETE: delete your data`,
        `• ENGLISH / HINGLISH / HINDI: choose the language I reply in`,
        ...(support ? [``, `To reach a person: ${support}`] : []),
      ].join("\n"),
    noTrip: `You have no active trip right now. Tell me where you want to go.`,
    paused: (d) => `Paused your ${d} trip. I won't send updates for it. Send RESUME to restart.`,
    alreadyPaused: (d) => `Your ${d} trip is already paused. Send RESUME to restart.`,
    resumed: (d) => `Resumed your ${d} trip.`,
    nothingPaused: `None of your trips is paused.`,
    watchPaused: `Price watch paused 🔕\n\nI'll stop sending price alerts for this trip. Say "resume watch" any time to turn it back on.`,
    watchResumed: `Price watch resumed 🔔\n\nI'll keep an eye on prices and message you if anything changes.`,
    watchNothing: `No active trip to watch right now. Plan a trip first, then I'll start watching prices.`,
    watchAlready: `Price watch is already paused. Say "resume watch" to turn it back on.`,
    watchNotPaused: `Price watch isn't paused right now.`,
    bookNoTrip: `You don't have an active trip to book right now. Tell me where you want to go and I'll plan it.`,
    bookNoPackages: `Your packages aren't ready yet. Say "yes" to search, or tell me what to change.`,
    bookNudge: (dest, links) =>
      `Great! To book your ${dest} trip, open the link below to complete the booking:\n\n${links}\n\nAfter booking, forward me the confirmation (screenshot or email) and I'll save it to your trip.`,
    waitAck: (dest) => `No problem — I'll keep watching prices for your ${dest} trip. I'll ping you if anything changes.`,
    statusHead: `Your trips:`,
    newTripLabel: `New trip (details not complete)`,
    pausedTag: `paused`,
    watchTag: `watch off`,
    stages: {
      DRAFT: `collecting trip details`,
      BRIEF_CONFIRMED: `brief ready, waiting for your OK`,
      PREVIEW_SENT: `preview sent, fee not paid yet`,
      FEE_PAID: `fee paid, preparing packages`,
      PACKAGES_SENT: `packages sent, waiting for your pick`,
      ITINERARY_SENT: `itinerary sent`,
      WATCHING: `watching prices`,
    },
    deleteAsk: `This permanently deletes your trips, chat history and profile, and it can't be undone.\n\nTo confirm, reply exactly: DELETE MY DATA`,
    deleted: `Done. Your trips, chat history and profile have been deleted. Records of a payment may be kept where the law requires it, without your trip details. Message me any time to start fresh.`,
    langSet: `Okay, I'll reply in English from now on.`,
  },
  hinglish: {
    stopped: `Aap opt-out ho gaye, ab main aapko message nahi karunga. Wapas aane ke liye kabhi bhi START likho.`,
    started: `Wapas swagat hai! Batao kahan jaana hai, ya "new trip" likho.`,
    alreadyActive: `Aap already active ho. Batao kahan jaana hai.`,
    help: (support) =>
      [
        `Main ye kar sakta hoon. Main ek AI assistant hoon.`,
        ``,
        `• Batao kahan jaana hai, main trip plan kar dunga`,
        `• "new trip": doosra trip shuru karo`,
        `• STATUS: apne trips dekho`,
        `• PAUSE / RESUME: latest trip ke updates roko ya dobara chalu karo`,
        `• PAUSE WATCH / RESUME WATCH: sirf price alerts roko ya chalu karo`,
        `• BOOK: latest trip ke booking links lo`,
        `• STOP: saare messages band (wapas aane ke liye START)`,
        `• DELETE: apna data hatao`,
        `• ENGLISH / HINGLISH / HINDI: main kis language mein jawab doon, wo chuno`,
        ...(support ? [``, `Insaan se baat karne ke liye: ${support}`] : []),
      ].join("\n"),
    noTrip: `Abhi aapka koi active trip nahi hai. Batao kahan jaana hai.`,
    paused: (d) => `${d} ka trip pause kar diya. Iske updates nahi bhejunga. Dobara chalu karne ke liye RESUME likho.`,
    alreadyPaused: (d) => `${d} ka trip pehle se paused hai. Chalu karne ke liye RESUME likho.`,
    resumed: (d) => `${d} ka trip dobara chalu kar diya.`,
    nothingPaused: `Aapka koi trip paused nahi hai.`,
    watchPaused: `Price watch pause kar diya 🔕\n\nIs trip ke liye price alerts band rahenge. Wapas chalu karne ke liye "resume watch" likho.`,
    watchResumed: `Price watch resume ho gaya 🔔\n\nMain prices par nazar rakhta rahunga aur kuch badle to message karunga.`,
    watchNothing: `Abhi koi active trip nahi hai watch karne ke liye. Pehle trip plan karo, phir main prices watch karunga.`,
    watchAlready: `Price watch pehle se paused hai. Chalu karne ke liye "resume watch" likho.`,
    watchNotPaused: `Price watch abhi paused nahi hai.`,
    bookNoTrip: `Abhi koi active trip nahi hai book karne ke liye. Batao kahan jaana hai, main plan kar dunga.`,
    bookNoPackages: `Aapke packages abhi ready nahi hain. "yes" likho search ke liye, ya bolo kya change karna hai.`,
    bookNudge: (dest, links) =>
      `Badhiya! Aapka ${dest} trip book karne ke liye ye link kholo:\n\n${links}\n\nBooking ke baad confirmation (screenshot ya email) mujhe forward kar do, main trip mein save kar dunga.`,
    waitAck: (dest) => `Koi baat nahi — main aapke ${dest} trip ke prices par nazar rakhta rahunga. Kuch badle to ping karunga.`,
    statusHead: `Aapke trips:`,
    newTripLabel: `Naya trip (details poori nahi)`,
    pausedTag: `paused`,
    watchTag: `watch off`,
    stages: {
      DRAFT: `trip ki details le raha hoon`,
      BRIEF_CONFIRMED: `brief taiyaar hai, aapke OK ka intezaar`,
      PREVIEW_SENT: `preview bheja, fee abhi baaki hai`,
      FEE_PAID: `fee mil gayi, packages bana raha hoon`,
      PACKAGES_SENT: `packages bheje, aapke pick ka intezaar`,
      ITINERARY_SENT: `itinerary bhej di`,
      WATCHING: `prices par nazar hai`,
    },
    deleteAsk: `Isse aapke trips, chat history aur profile hamesha ke liye delete ho jayenge, wapas nahi aayenge.\n\nConfirm karne ke liye ye likho: DELETE MY DATA`,
    deleted: `Ho gaya. Aapke trips, chat history aur profile delete ho gaye. Payment ka record, jahan kanoon maangta hai, aapke trip ki details ke bina rakha ja sakta hai. Kabhi bhi message karo, naye sire se shuru karenge.`,
    langSet: `Theek hai, ab main Hinglish mein jawab dunga.`,
  },
  hi: {
    stopped: `आप opt-out हो गए, अब मैं आपको message नहीं करूँगा। वापस आने के लिए कभी भी START लिखें।`,
    started: `वापस स्वागत है! बताएँ कहाँ जाना है, या "new trip" लिखें।`,
    alreadyActive: `आप already active हैं। बताएँ कहाँ जाना है।`,
    help: (support) =>
      [
        `मैं यह कर सकता हूँ। मैं एक AI assistant हूँ।`,
        ``,
        `• बताएँ कहाँ जाना है, मैं trip plan कर दूँगा`,
        `• "new trip": दूसरा trip शुरू करें`,
        `• STATUS: अपने trips देखें`,
        `• PAUSE / RESUME: latest trip के updates रोकें या दोबारा चालू करें`,
        `• PAUSE WATCH / RESUME WATCH: सिर्फ price alerts रोकें या चालू करें`,
        `• BOOK: latest trip के booking links लें`,
        `• STOP: सारे messages बंद (वापस आने के लिए START)`,
        `• DELETE: अपना data हटाएँ`,
        `• ENGLISH / HINGLISH / HINDI: मैं किस भाषा में जवाब दूँ, वह चुनें`,
        ...(support ? [``, `किसी व्यक्ति से बात करने के लिए: ${support}`] : []),
      ].join("\n"),
    noTrip: `अभी आपका कोई active trip नहीं है। बताएँ कहाँ जाना है।`,
    paused: (d) => `${d} का trip pause कर दिया। इसके updates नहीं भेजूँगा। दोबारा चालू करने के लिए RESUME लिखें।`,
    alreadyPaused: (d) => `${d} का trip पहले से paused है। चालू करने के लिए RESUME लिखें।`,
    resumed: (d) => `${d} का trip दोबारा चालू कर दिया।`,
    nothingPaused: `आपका कोई trip paused नहीं है।`,
    watchPaused: `Price watch pause कर दिया 🔕\n\nइस trip के लिए price alerts बंद रहेंगे। वापस चालू करने के लिए "resume watch" लिखें।`,
    watchResumed: `Price watch resume हो गया 🔔\n\nमैं prices पर नज़र रखता रहूँगा और कुछ बदले तो message करूँगा।`,
    watchNothing: `अभी कोई active trip नहीं है watch करने के लिए। पहले trip plan करें, फिर मैं prices watch करूँगा।`,
    watchAlready: `Price watch पहले से paused है। चालू करने के लिए "resume watch" लिखें।`,
    watchNotPaused: `Price watch अभी paused नहीं है।`,
    bookNoTrip: `अभी कोई active trip नहीं है book करने के लिए। बताएँ कहाँ जाना है, मैं plan कर दूँगा।`,
    bookNoPackages: `आपके packages अभी ready नहीं हैं। "yes" लिखें search के लिए, या बताएँ क्या बदलना है।`,
    bookNudge: (dest, links) =>
      `बहुत बढ़िया! अपना ${dest} trip book करने के लिए यह link खोलें:\n\n${links}\n\nBooking के बाद confirmation (screenshot या email) मुझे forward कर दें, मैं trip में save कर दूँगा।`,
    waitAck: (dest) => `कोई बात नहीं — मैं आपके ${dest} trip के prices पर नज़र रखता रहूँगा। कुछ बदले तो ping करूँगा।`,
    statusHead: `आपके trips:`,
    newTripLabel: `नया trip (details पूरी नहीं)`,
    pausedTag: `paused`,
    watchTag: `watch off`,
    stages: {
      DRAFT: `trip की details ले रहा हूँ`,
      BRIEF_CONFIRMED: `brief तैयार है, आपके OK का इंतज़ार`,
      PREVIEW_SENT: `preview भेजा, fee अभी बाकी है`,
      FEE_PAID: `fee मिल गई, packages बना रहा हूँ`,
      PACKAGES_SENT: `packages भेजे, आपके pick का इंतज़ार`,
      ITINERARY_SENT: `itinerary भेज दी`,
      WATCHING: `prices पर नज़र है`,
    },
    deleteAsk: `इससे आपके trips, chat history और profile हमेशा के लिए delete हो जाएँगे, वापस नहीं आएँगे।\n\nConfirm करने के लिए यह लिखें: DELETE MY DATA`,
    deleted: `हो गया। आपके trips, chat history और profile delete हो गए। Payment का record, जहाँ कानून माँगता है, आपके trip की details के बिना रखा जा सकता है। कभी भी message करें, नए सिरे से शुरू करेंगे।`,
    langSet: `ठीक है, अब मैं हिंदी में जवाब दूँगा।`,
  },
};

function T(lang) {
  if (lang === "hi") return TEXT.hi;
  if (lang === "hinglish") return TEXT.hinglish;
  return TEXT.en;
}

async function activeTrips(travelerId) {
  return Trip.find({ travelerId, status: { $nin: TERMINAL } }).sort({ updatedAt: -1 }).limit(3);
}

const destOf = (trip) => trip.brief?.destination || trip.destination || "your";

// Build booking links for a trip's chosen package
function buildBookingLinks(trip) {
  const pkg =
    (trip.packages || []).find((p) => p.tier === trip.chosenTier) ||
    trip.packages?.[0] ||
    {};

  const links = [];
  const flightUrl = pkg.flight?.bookingUrl || pkg.flight?.url;
  const hotelUrl = pkg.hotel?.bookingUrl || pkg.hotel?.url;

  if (flightUrl) links.push(`✈️ Flight: ${flightUrl}`);
  if (hotelUrl) links.push(`🏨 Hotel: ${hotelUrl}`);

  if (!links.length) {
    // Fallback: use base URL for itinerary PDF
    const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    if (trip.shareToken) {
      links.push(`📱 Itinerary: ${baseUrl}/itinerary/${trip._id}?t=${trip.shareToken}`);
    }
  }

  return links.length ? links.join("\n") : "👉 Please reply with the flight and hotel you want to book.";
}

// ── Run ──────────────────────────────────────────────────────

export async function runCommand(cmd, traveler, lang) {
  const tx = T(lang);

  switch (cmd) {
    case "STOP": {
      traveler.optedOut = true;
      traveler.optedOutAt = new Date();
      await traveler.save();
      return { text: tx.stopped, log: true };
    }

    case "START": {
      if (!traveler.optedOut) return { text: tx.alreadyActive, log: true };
      traveler.optedOut = false;
      traveler.optedOutAt = undefined;
      await traveler.save();
      return { text: tx.started, log: true };
    }

    case "HELP":
      return { text: tx.help(process.env.SUPPORT_CONTACT || ""), log: true };

    case "BOOK": {
      const [trip] = await activeTrips(traveler._id);
      if (!trip) return { text: tx.bookNoTrip, log: true };
      if (!trip.packages?.length) return { text: tx.bookNoPackages, log: true };

      const dest = destOf(trip);
      const links = buildBookingLinks(trip);
      return { text: tx.bookNudge(dest, links), log: true };
    }

    case "WAIT": {
      const [trip] = await activeTrips(traveler._id);
      if (!trip) return { text: tx.bookNoTrip, log: true };
      return { text: tx.waitAck(destOf(trip)), log: true };
    }

    case "PAUSE": {
      const [trip] = await activeTrips(traveler._id);
      if (!trip) return { text: tx.noTrip, log: true };
      if (trip.paused) return { text: tx.alreadyPaused(destOf(trip)), log: true };
      trip.paused = true;
      await trip.save();
      return { text: tx.paused(destOf(trip)), log: true };
    }

    case "RESUME": {
      const trips = await activeTrips(traveler._id);
      const trip = trips.find((t) => t.paused);
      if (!trip) return { text: tx.nothingPaused, log: true };
      trip.paused = false;
      await trip.save();
      return { text: tx.resumed(destOf(trip)), log: true };
    }

    case "PAUSE_WATCH": {
      const [trip] = await activeTrips(traveler._id);
      if (!trip) return { text: tx.watchNothing, log: true };
      if (trip.watchPaused) return { text: tx.watchAlready, log: true };
      trip.watchPaused = true;
      await trip.save();
      return { text: tx.watchPaused, log: true };
    }

    case "RESUME_WATCH": {
      const [trip] = await activeTrips(traveler._id);
      if (!trip) return { text: tx.watchNothing, log: true };
      if (!trip.watchPaused) return { text: tx.watchNotPaused, log: true };
      trip.watchPaused = false;
      await trip.save();
      return { text: tx.watchResumed, log: true };
    }

    case "STATUS": {
      const trips = await activeTrips(traveler._id);
      if (trips.length === 0) return { text: tx.noTrip, log: true };

      const lines = trips.map((t, i) => {
        const b = t.brief || {};
        const label = b.destination
          ? `${b.destination}${b.departDate && b.returnDate ? ` (${b.departDate} → ${b.returnDate})` : ""}`
          : tx.newTripLabel;
        const stage = tx.stages[t.status] || t.status;
        const tags = [];
        if (t.paused) tags.push(tx.pausedTag);
        if (t.watchPaused) tags.push(tx.watchTag);
        const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
        return `${i + 1}. ${label}: ${stage}${tagStr}`;
      });
      return { text: `${tx.statusHead}\n${lines.join("\n")}`, log: true };
    }

    case "LANG_EN":
    case "LANG_HINGLISH":
    case "LANG_HI": {
      const chosen = cmd === "LANG_EN" ? "en" : cmd === "LANG_HI" ? "hi" : "hinglish";
      traveler.language = chosen;
      traveler.languageLocked = true;
      await traveler.save();
      const text =
        chosen === "hi"
          ? `ठीक है, अब मैं हिंदी में जवाब दूँगा।`
          : T(chosen).langSet;
      return { text, log: true };
    }

    case "DELETE":
      return { text: tx.deleteAsk, log: true };

    case "CONFIRM_DELETE": {
      const id = traveler._id;
      await Message.deleteMany({ travelerId: id });
      await Trip.deleteMany({ travelerId: id, feePaid: { $ne: true } });
      await Trip.updateMany(
        { travelerId: id, feePaid: true },
        {
          $set: { brief: {}, packages: [], itinerary: null, status: "CANCELLED" },
          $unset: {
            travelerId: "",
            destination: "",
            title: "",
            startDate: "",
            endDate: "",
            chosenTier: "",
          },
        }
      );
      await Traveler.deleteOne({ _id: id });
      return { text: tx.deleted, log: false };
    }

    default:
      return { text: tx.help(process.env.SUPPORT_CONTACT || ""), log: true };
  }
}