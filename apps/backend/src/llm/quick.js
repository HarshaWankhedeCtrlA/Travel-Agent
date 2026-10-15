// Parses short answers to the question we just asked. No LLM needed.
function parseMoney(t) {
  const m = t.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(k|thousand|hazaar|lakh|lac|l)?\b/);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  const u = m[2];
  if (u === "k" || u === "thousand" || u === "hazaar") n *= 1000;
  else if (u === "lakh" || u === "lac" || u === "l") n *= 100000;
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function quickParse(text, expect = "", brief = {}) {
  const t = String(text || "").trim();
  const wants = String(expect).split(" and ").filter(Boolean);
  const out = {};

  if (wants.includes("travelers")) {
    if (/\b(solo|akela|akele|alone)\b/i.test(t)) out.travelers = 1;
    else if (/\b(couple|dono)\b/i.test(t)) out.travelers = 2;
    else {
      const m = t.match(/^\D{0,10}(\d{1,2})\s*(people|persons|log|members|adults|pax)?\s*\.?$/i);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 20) out.travelers = Number(m[1]);
    }
  }

  if (wants.includes("budget")) {
    const n = parseMoney(t);
    if (n && n >= 5000 && n <= 5000000) out.budget = n;
  }

  if (wants.includes("returnDate") && brief.departDate) {
    const m = t.match(/(\d{1,2})\s*(nights?|raat|din|days?)/i);
    if (m) {
      let nights = Number(m[1]);
      if (/days?|din/i.test(m[2])) nights = Math.max(1, nights - 1);
      const d = new Date(`${brief.departDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + nights);
      out.returnDate = d.toISOString().slice(0, 10);
    }
  }

  // Single-field city answer: "Delhi", "from Pune", "Pune se"
  const city = t.replace(/^(from|to)\s+/i, "").replace(/\s+(se|ko|jana hai|jaana hai)$/i, "").trim();
  if (/^[A-Za-z][A-Za-z .'-]{1,40}$/.test(city) && city.split(" ").length <= 3) {
    if (wants.length === 1 && wants[0] === "origin") out.origin = city;
    if (wants.length === 1 && wants[0] === "destination") out.destination = city;
  }
  return out;
}