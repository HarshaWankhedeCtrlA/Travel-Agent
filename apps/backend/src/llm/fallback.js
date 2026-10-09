// Rule-based brief extraction. NOT used by default.
// The gateway only falls back to this when LLM_FALLBACK=rules is set and the
// Grok call is unavailable (no key, timeout, outage). It is regex-based and
// limited to the cities listed below, so treat it as a safety net only.
//
// extractBrief(text, { expect, brief })
//   expect: the field the bot just asked about ("origin", "travelers", ...),
//           so a bare answer like "3" or "Delhi" can be understood.
//   brief:  the brief so far (needed to turn "5 nights" into a return date).
// Returns only the fields it found.

const DESTINATIONS = [
  "goa", "manali", "jaipur", "kerala", "bali", "dubai", "paris", "singapore",
  "udaipur", "shimla", "leh", "ladakh", "kashmir", "rishikesh", "andaman",
  "bangkok", "thailand", "maldives",
];

const ORIGINS = [
  "delhi", "mumbai", "bangalore", "bengaluru", "pune", "kolkata", "chennai",
  "hyderabad", "ahmedabad", "srinagar", "lucknow", "chandigarh", "jaipur",
];

const KNOWN_CITIES = [...new Set([...DESTINATIONS, ...ORIGINS])];

const MON =
  "(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)";
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const RANGE_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|-|–|till|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\b`);
const DAY_MONTH_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\b`);
// "december 5 nights" is a month plus a length of stay, not the 5th of December
const MONTH_DAY_RE = new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:nights?|days?)\\b)`);
const MONTH_ONLY_RE = new RegExp(`\\b${MON}\\b`);

export async function extractBriefWithRules(text, { expect, brief } = {}) {
  const lower = String(text || "").toLowerCase();
  const out = {};

  Object.assign(out, parseCities(lower, expect));
  Object.assign(out, parseDates(lower, { expect, brief }));

  const budget = parseBudget(lower);
  if (budget) out.budget = budget;

  const travelers = parseTravelers(lower, expect);
  if (travelers) out.travelers = travelers;

  // A trip from a city to itself makes no sense
  if (out.origin && out.origin === (out.destination || brief?.destination)) {
    delete out.origin;
  }

  return out;
}

// ── Cities ───────────────────────────────────────────────────

function findCity(text, list) {
  for (const c of list) {
    if (new RegExp(`\\b${c}\\b`).test(text)) return c;
  }
  return null;
}

function parseCities(lower, expect) {
  const out = {};
  let rest = lower;

  // "delhi to goa"
  const pair = lower.match(/\b([a-z]+)\s+to\s+([a-z]+)\b/);
  if (pair && KNOWN_CITIES.includes(pair[1]) && KNOWN_CITIES.includes(pair[2])) {
    out.origin = title(pair[1]);
    out.destination = title(pair[2]);
    return out;
  }

  // "from delhi"
  const from = lower.match(/\bfrom\s+([a-z]+)\b/);
  if (from && KNOWN_CITIES.includes(from[1])) {
    out.origin = title(from[1]);
    rest = rest.replace(from[0], " ");
  }

  // A message that is just a city name is read according to the question
  // that was asked ("Delhi" after "Which city are you travelling from?")
  const bare = lower.replace(/[^a-z\s]/g, "").trim();
  if (KNOWN_CITIES.includes(bare)) {
    if (expect === "origin" && !out.origin) {
      out.origin = title(bare);
      return out;
    }
    if (expect === "destination") {
      out.destination = title(bare);
      return out;
    }
  }

  const dest = findCity(rest, DESTINATIONS);
  if (dest) out.destination = title(dest);

  return out;
}

// ── Budget ───────────────────────────────────────────────────

const MIN_BUDGET = 5000;
const MAX_BUDGET = 5000000;

function inRange(n) {
  return Number.isFinite(n) && n >= MIN_BUDGET && n <= MAX_BUDGET ? Math.round(n) : null;
}

function parseBudget(lower) {
  let m = lower.match(/(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?)\b/); // 1.5 lakh
  if (m) {
    const n = inRange(parseFloat(m[1]) * 100000);
    if (n) return n;
  }

  m = lower.match(/(\d+(?:\.\d+)?)\s*(?:k|thousand)\b/); // 30k
  if (m) {
    const n = inRange(parseFloat(m[1]) * 1000);
    if (n) return n;
  }

  // 30000, 30,000, 1,50,000 (first one in range wins, so years like 2026 are skipped)
  for (const p of lower.matchAll(/\b(\d{1,3}(?:,\d{2,3})+|\d{4,7})\b/g)) {
    const n = inRange(parseInt(p[1].replace(/,/g, ""), 10));
    if (n) return n;
  }

  return null;
}

// ── Travelers ────────────────────────────────────────────────

function parseTravelers(lower, expect) {
  const m = lower.match(/(\d{1,2})\s*(?:people|pax|persons?|adults?|travell?ers?|of us|members)/);
  if (m) return clampPax(parseInt(m[1], 10));

  if (/\bcouple\b/.test(lower)) return 2;
  if (/\b(solo|alone|myself)\b/.test(lower)) return 1;

  if (expect === "travelers") {
    const bare = lower.match(/^\s*(\d{1,2})\s*$/);
    if (bare) return clampPax(parseInt(bare[1], 10));
  }
  return null;
}

function clampPax(n) {
  return n >= 1 && n <= 20 ? n : null;
}

// ── Dates ────────────────────────────────────────────────────

function monthIdx(word) {
  return MONTH_KEYS.indexOf(word.slice(0, 3));
}

// Next occurrence of month/day, built in UTC so ISO output never shifts a day.
function buildDate(monthIndex, day) {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let year = now.getFullYear();
  if (Date.UTC(year, monthIndex, day) < today) year += 1;
  const d = new Date(Date.UTC(year, monthIndex, day));
  return d.getUTCMonth() === monthIndex ? d : null; // rejects 31 Feb etc.
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const fromIso = (s) => new Date(`${s}T00:00:00Z`);

function parseNights(lower, expect) {
  const m = lower.match(/(\d{1,2})\s*(nights?|days?)\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    const nights = /^night/.test(m[2]) ? n : n - 1; // "5 days" = 4 nights
    return nights >= 1 && nights <= 60 ? nights : null;
  }
  if (expect === "returnDate") {
    const bare = lower.match(/^\s*(\d{1,2})\s*$/);
    if (bare) {
      const n = parseInt(bare[1], 10);
      return n >= 1 && n <= 60 ? n : null;
    }
  }
  return null;
}

function parseDates(lower, { expect, brief }) {
  const out = {};
  let depart = null;
  let ret = null;

  const range = lower.match(RANGE_RE); // "20 to 27 dec"
  if (range) {
    const m = monthIdx(range[3]);
    depart = buildDate(m, parseInt(range[1], 10));
    if (depart) {
      const r = new Date(Date.UTC(depart.getUTCFullYear(), m, parseInt(range[2], 10)));
      if (r.getUTCMonth() === m && r > depart) ret = r;
      out.datesApproximate = false;
    }
  } else {
    const dm = lower.match(DAY_MONTH_RE); // "20 dec"
    const md = lower.match(MONTH_DAY_RE); // "dec 20"
    const single = dm
      ? { m: monthIdx(dm[2]), d: parseInt(dm[1], 10) }
      : md
      ? { m: monthIdx(md[1]), d: parseInt(md[2], 10) }
      : null;

    if (single) {
      const date = buildDate(single.m, single.d);
      if (date) {
        if (expect === "returnDate" && brief?.departDate) {
          // The traveler is answering "when do you come back?"
          if (date > fromIso(brief.departDate)) ret = date;
        } else {
          depart = date;
          out.datesApproximate = false;
        }
      }
    } else {
      // Month only: keep a placeholder day and flag it so the bot can say so
      const mo = lower.match(MONTH_ONLY_RE);
      if (mo && expect !== "returnDate") {
        const word = mo[1];
        // "may" is also a verb; accept it only when it clearly means the month
        const clearMay =
          word !== "may" || expect === "departDate" || /\b(in|for|during|around|of|by)\s+may\b/.test(lower);
        if (clearMay) {
          depart = buildDate(monthIdx(word), 15);
          out.datesApproximate = true;
        }
      }
    }
  }

  // "5 nights" or a bare "5" after the return-date question
  if (!ret) {
    const nights = parseNights(lower, expect);
    const base = depart || (brief?.departDate ? fromIso(brief.departDate) : null);
    if (nights && base) ret = addDays(base, nights);
  }

  if (depart) out.departDate = iso(depart);
  if (ret) out.returnDate = iso(ret);
  return out;
}

function title(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}