// WhatsApp provider — mock (dev) or Meta Cloud API (real WhatsApp).
// Same interface for both, so nothing else in the app changes.
//
// Env:
//   WHATSAPP_PROVIDER          "mock" (default) | "meta"
//   WHATSAPP_ACCESS_TOKEN      Meta Cloud API token
//   WHATSAPP_PHONE_NUMBER_ID   Meta test/production phone number ID
//   META_API_VERSION           optional, default "v21.0"

const outbox = new Map(); // phone -> [{ id, body, at }]  (mock only)

// WhatsApp rejects a body over 1600 characters. Stay under it.
const MAX_LEN = 1500;
const SEND_GAP_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function genId() {
  return "wa_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function useMeta() {
  return (process.env.WHATSAPP_PROVIDER || "mock").toLowerCase() === "meta";
}

function apiVersion() {
  return process.env.META_API_VERSION || "v21.0";
}

// The app stores numbers as digits, for example "919876543210".
function normalizePhone(to) {
  return String(to || "").replace(/\D/g, "");
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

export async function sendText(to, body) {
  if (useMeta()) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      console.error("[whatsapp] Meta credentials not set");
      return { id: null, error: "Meta credentials not set" };
    }

    const url = `https://graph.facebook.com/${apiVersion()}/${phoneId}/messages`;
    let lastId = null;

    try {
      for (const part of splitMessage(String(body))) {
        const payload = {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: normalizePhone(to),
          type: "text",
          text: { preview_url: false, body: part },
        };

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
          console.error(`[whatsapp] Meta send failed (${res.status}):`, data.error?.message);
          return { id: lastId, error: data.error?.message || `HTTP ${res.status}` };
        }

        lastId = data.messages?.[0]?.id || null;
        await sleep(SEND_GAP_MS);
      }
      console.log(`[WA → ${String(to).slice(0, 2)}******] sent via meta (${lastId})`);
      return { id: lastId };
    } catch (err) {
      console.error("[whatsapp] Meta send failed:", err.message);
      return { id: lastId, error: err.message };
    }
  }

  const id = genId();
  console.log(`\n[WA → ${to}]\n${body}\n`);
  pushOutbox(to, { id, body, at: Date.now() });
  return { id };
}

export async function sendButtons(to, body, buttons) {
  const label = buttons.map((b) => `• ${b.title}`).join("\n");
  const full = `${body}\n\n${label}`;
  return sendText(to, full);
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