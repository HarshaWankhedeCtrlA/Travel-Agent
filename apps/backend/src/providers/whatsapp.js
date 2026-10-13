// WhatsApp provider — mock (dev) or Twilio (real WhatsApp).
// Same interface for both, so nothing else in the app changes.
//
// Env:
//   WHATSAPP_PROVIDER   "mock" (default) | "twilio"
//   TWILIO_ACCOUNT_SID  required for twilio
//   TWILIO_AUTH_TOKEN   required for twilio
//   TWILIO_WHATSAPP_FROM  e.g. "whatsapp:+14155238886"

const outbox = new Map(); // phone -> [{ id, body, at }]  (mock only)

// WhatsApp through Twilio rejects a body over 1600 characters. Stay under it.
const MAX_LEN = 1500;
// Small gap between messages so they arrive in the order they were sent.
const SEND_GAP_MS = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function genId() {
  return "wa_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function useTwilio() {
  return (process.env.WHATSAPP_PROVIDER || "mock").toLowerCase() === "twilio";
}

// Lazy-load Twilio SDK so mock mode never needs the dependency installed.
let twilioClient = null;
async function getTwilioClient() {
  if (twilioClient) return twilioClient;
  const { default: twilio } = await import("twilio");
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Twilio credentials not set");
  twilioClient = twilio(sid, token);
  return twilioClient;
}

// The app stores numbers as digits, for example "919876543210". A 10-digit
// number is Indian. Anything longer already carries its country code.
function normalizePhone(to) {
  const s = String(to || "").trim();
  if (s.startsWith("whatsapp:")) return s;
  const digits = s.replace(/\D/g, "");
  return `whatsapp:+${digits.length === 10 ? "91" + digits : digits}`;
}

function fromNumber() {
  return process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
}

// Split a long text at paragraph breaks so no part passes MAX_LEN.
function splitMessage(text) {
  if (text.length <= MAX_LEN) return [text];

  const chunks = [];
  let cur = "";
  const push = () => {
    if (cur) {
      chunks.push(cur);
      cur = "";
    }
  };

  for (const para of text.split("\n\n")) {
    if (para.length > MAX_LEN) {
      push();
      for (let i = 0; i < para.length; i += MAX_LEN) chunks.push(para.slice(i, i + MAX_LEN));
      continue;
    }
    if (cur && (cur + "\n\n" + para).length > MAX_LEN) push();
    cur = cur ? cur + "\n\n" + para : para;
  }
  push();
  return chunks;
}

// ── Public API ──────────────────────────────────────────────

// Returns { id } on success, or { id: null, error } if Twilio refused the send.
// It never throws, so one failed delivery cannot stop a conversation halfway.
export async function sendText(to, body) {
  if (useTwilio()) {
    let lastId = null;
    try {
      const client = await getTwilioClient();
      for (const part of splitMessage(String(body))) {
        const msg = await client.messages.create({
          from: fromNumber(),
          to: normalizePhone(to),
          body: part,
        });
        lastId = msg.sid;
        await sleep(SEND_GAP_MS);
      }
      console.log(`[WA → ${String(to).slice(0, 2)}******] sent via twilio (${lastId})`);
      return { id: lastId };
    } catch (err) {
      // Not copied to the mock outbox: that would hide a real delivery failure
      console.error(`[whatsapp] twilio send failed (code ${err.code || "?"}): ${err.message}`);
      return { id: lastId, error: err.message };
    }
  }

  const id = genId();
  console.log(`\n[WA → ${to}]\n${body}\n`);
  pushOutbox(to, { id, body, at: Date.now() });
  return { id };
}

export async function sendButtons(to, body, buttons) {
  // Twilio sandbox does not support interactive buttons — send as text.
  const label = buttons.map((b) => `• ${b.title}`).join("\n");
  const full = `${body}\n\n${label}`;

  if (useTwilio()) {
    return sendText(to, full);
  }

  const id = genId();
  console.log(`\n[WA → ${to}]\n${body}\n[Buttons: ${label}]\n`);
  pushOutbox(to, { id, body, buttons, at: Date.now() });
  return { id };
}

// ── Mock-only helpers ──────────────────────────────────────

function pushOutbox(phone, msg) {
  if (!outbox.has(phone)) outbox.set(phone, []);
  outbox.get(phone).push(msg);
}

export function drainOutbox(phone) {
  const msgs = outbox.get(phone) || [];
  outbox.set(phone, []);
  return msgs;
}