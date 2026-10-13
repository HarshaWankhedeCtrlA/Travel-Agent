// Always-available commands (PRD section 11): STOP, START, HELP, PAUSE, RESUME,
// STATUS, DELETE. A command is a message that is exactly the keyword, so a
// sentence like "please don't stop the plan" is never read as a command.
//
// parseCommand(text)               -> "STOP" | "START" | ... | null
// runCommand(cmd, traveler, lang)  -> { text, log }
//   log is false for DELETE: the traveler's records are gone, so the reply must
//   not be written to the message log again.
//
// Env: SUPPORT_CONTACT (optional) is shown in HELP as the way to reach a person.

import Traveler from "../models/traveler.js";
import Trip from "../models/trip.js";
import Message from "../models/message.js";

const TERMINAL = ["BOOKED", "CANCELLED"];

const COMMANDS = {
  STOP: ["stop", "stop all", "unsubscribe", "opt out", "optout"],
  START: ["start", "subscribe"],
  HELP: ["help", "menu", "madad"],
  PAUSE: ["pause"],
  RESUME: ["resume"],
  STATUS: ["status"],
  DELETE: ["delete", "delete data"],
  CONFIRM_DELETE: ["delete my data"],
};

export function parseCommand(text) {
  const n = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return null;
  for (const [cmd, words] of Object.entries(COMMANDS)) {
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
        `• STOP: stop all messages (START to come back)`,
        `• DELETE: delete your data`,
        ...(support ? [``, `To reach a person: ${support}`] : []),
      ].join("\n"),
    noTrip: `You have no active trip right now. Tell me where you want to go.`,
    paused: (d) => `Paused your ${d} trip. I won't send updates for it. Send RESUME to restart.`,
    alreadyPaused: (d) => `Your ${d} trip is already paused. Send RESUME to restart.`,
    resumed: (d) => `Resumed your ${d} trip.`,
    nothingPaused: `None of your trips is paused.`,
    statusHead: `Your trips:`,
    newTripLabel: `New trip (details not complete)`,
    pausedTag: `paused`,
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
        `• STOP: saare messages band (wapas aane ke liye START)`,
        `• DELETE: apna data hatao`,
        ...(support ? [``, `Insaan se baat karne ke liye: ${support}`] : []),
      ].join("\n"),
    noTrip: `Abhi aapka koi active trip nahi hai. Batao kahan jaana hai.`,
    paused: (d) => `${d} ka trip pause kar diya. Iske updates nahi bhejunga. Dobara chalu karne ke liye RESUME likho.`,
    alreadyPaused: (d) => `${d} ka trip pehle se paused hai. Chalu karne ke liye RESUME likho.`,
    resumed: (d) => `${d} ka trip dobara chalu kar diya.`,
    nothingPaused: `Aapka koi trip paused nahi hai.`,
    statusHead: `Aapke trips:`,
    newTripLabel: `Naya trip (details poori nahi)`,
    pausedTag: `paused`,
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
  },
};

function T(lang) {
  return lang === "hinglish" || lang === "hi" ? TEXT.hinglish : TEXT.en;
}

async function activeTrips(travelerId) {
  return Trip.find({ travelerId, status: { $nin: TERMINAL } }).sort({ updatedAt: -1 }).limit(3);
}

const destOf = (trip) => trip.brief?.destination || trip.destination || "your";

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

    case "STATUS": {
      const trips = await activeTrips(traveler._id);
      if (trips.length === 0) return { text: tx.noTrip, log: true };

      const lines = trips.map((t, i) => {
        const b = t.brief || {};
        const label = b.destination
          ? `${b.destination}${b.departDate && b.returnDate ? ` (${b.departDate} → ${b.returnDate})` : ""}`
          : tx.newTripLabel;
        const stage = tx.stages[t.status] || t.status;
        return `${i + 1}. ${label}: ${stage}${t.paused ? ` [${tx.pausedTag}]` : ""}`;
      });
      return { text: `${tx.statusHead}\n${lines.join("\n")}`, log: true };
    }

    case "DELETE":
      return { text: tx.deleteAsk, log: true };

    case "CONFIRM_DELETE": {
      const id = traveler._id;

      await Message.deleteMany({ travelerId: id });

      // Unpaid trips are deleted. A paid trip keeps only its payment fields
      // (for accounting) with the traveler link and all trip content removed.
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