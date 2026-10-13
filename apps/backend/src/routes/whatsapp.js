// Twilio WhatsApp webhook.
// Twilio sends inbound messages as form-encoded POST to this route.
//
// Configure in Twilio Console → Messaging → Try it out → WhatsApp Sandbox:
//   "When a message comes in":  https://YOUR-NGROK-URL/api/whatsapp/twilio
//   Method: POST
//
// Env:
//   TWILIO_AUTH_TOKEN     required: used to verify that Twilio really sent the request
//   APP_BASE_URL          the public https URL of this server (same one Twilio calls)
//   TWILIO_WEBHOOK_URL    optional: full webhook URL, if it differs from APP_BASE_URL + the path
//   TWILIO_SKIP_SIGNATURE "true" skips the check, and only works outside production (local debugging)

import { Router } from "express";
import { handleIncoming } from "../orchestrator/index.js";
import * as wa from "../providers/whatsapp.js";

const router = Router();

// Without this check anyone could POST a fake "From" and act as any traveler,
// including sending DELETE MY DATA for someone else's number.
async function isFromTwilio(req) {
  if (process.env.TWILIO_SKIP_SIGNATURE === "true" && process.env.NODE_ENV !== "production") {
    return true;
  }
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.get("x-twilio-signature");
  if (!token || !signature) return false;

  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const url = process.env.TWILIO_WEBHOOK_URL || `${base}/api/whatsapp/twilio`;

  const { default: twilio } = await import("twilio");
  return twilio.validateRequest(token, signature, url, req.body || {});
}

// Twilio can deliver the same message twice. Remember recent message ids.
const seen = new Map(); // MessageSid -> time
function alreadySeen(sid) {
  if (!sid) return false;
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 10 * 60 * 1000) seen.delete(k);
  if (seen.has(sid)) return true;
  seen.set(sid, now);
  return false;
}

// One message at a time per traveler. Two quick messages would otherwise
// both read the same trip state and both act on it.
const queues = new Map(); // phone -> promise
function enqueue(phone, job) {
  const next = (queues.get(phone) || Promise.resolve()).catch(() => {}).then(job);
  queues.set(phone, next);
  next.finally(() => {
    if (queues.get(phone) === next) queues.delete(phone);
  });
  return next;
}

router.post("/twilio", async (req, res) => {
  if (!process.env.TWILIO_AUTH_TOKEN) {
    console.error("[whatsapp] TWILIO_AUTH_TOKEN is not set; rejecting inbound message");
    return res.sendStatus(503);
  }
  if (!(await isFromTwilio(req))) {
    console.warn("[whatsapp] rejected a request with an invalid Twilio signature");
    return res.sendStatus(403);
  }

  // Reply 200 immediately so Twilio does not retry
  res.type("text/xml").send("<Response></Response>");

  try {
    const { From, Body, MessageSid, NumMedia } = req.body || {};
    if (!From || alreadySeen(MessageSid)) return;

    // Digits only, same format the app has always stored: "919876543210"
    const phone = String(From).replace(/^whatsapp:/, "").replace(/\D/g, "");

    const text = String(Body || "").trim();
    if (!text) {
      // Voice notes, images and so on: text only for now
      if (Number(NumMedia) > 0) {
        await wa.sendText(phone, "I can only read text messages for now. Please type your message.");
      }
      return;
    }

    console.log(`[whatsapp] inbound (${phone.slice(0, 2)}******${phone.slice(-2)}): ${text.length} chars`);

    await enqueue(phone, () => handleIncoming({ from: phone, body: text }));
  } catch (err) {
    console.error("[whatsapp] webhook failed:", err);
  }
});

export default router;