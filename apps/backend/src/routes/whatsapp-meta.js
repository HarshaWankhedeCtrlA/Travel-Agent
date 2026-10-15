// Meta Cloud API webhook.
// Configure in Meta Dashboard → WhatsApp → Configuration:
//   Callback URL:  https://YOUR-NGROK-URL/api/whatsapp/meta
//   Verify token:  WHATSAPP_VERIFY_TOKEN (from .env)
//
// Env:
//   WHATSAPP_VERIFY_TOKEN  required: shown to Meta during webhook setup
//   META_APP_SECRET        required: used to verify that Meta really sent the request

import { Router } from "express";
import crypto from "node:crypto";
import { handleIncoming } from "../orchestrator/index.js";

const router = Router();

// ─────────────────────────────────────────────────────────────
// In-memory dedup of Meta message IDs. Meta sometimes delivers the same
// message twice (retries, dual-region webhooks). We skip duplicates here.
// For multi-instance deployments, swap for Redis.
const seenMessageIds = new Set();
const MAX_SEEN = 2000;

function rememberMessageId(id) {
  if (!id) return false;              // no id = cannot dedup, process it
  if (seenMessageIds.has(id)) return true;   // already seen
  seenMessageIds.add(id);
  if (seenMessageIds.size > MAX_SEEN) {
    // drop oldest entries (Set preserves insertion order)
    const toDrop = seenMessageIds.size - MAX_SEEN;
    let i = 0;
    for (const v of seenMessageIds) {
      if (i++ >= toDrop) break;
      seenMessageIds.delete(v);
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// Meta sends GET to verify the webhook once during setup.
router.get("/meta", (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("[whatsapp] webhook verified");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ─────────────────────────────────────────────────────────────
// Meta sends POST for every incoming message AND for status events.
router.post("/meta", async (req, res) => {
  // Respond 200 immediately — Meta requires it within a few seconds.
  res.sendStatus(200);

  try {
    // 1. Verify the signature (Meta signs the raw body with your app secret).
    const signature = req.get("x-hub-signature-256");
    const appSecret = process.env.META_APP_SECRET;
    if (signature && appSecret && req.rawBody) {
      const [, sig] = signature.split("=");
      const expected = crypto
        .createHmac("sha256", appSecret)
        .update(req.rawBody)
        .digest("hex");
      if (sig !== expected) {
        console.warn("[whatsapp] rejected a request with an invalid Meta signature");
        return;
      }
    }

    // 2. Extract the payload.
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // 3. Log what arrived (helps debug Meta's occasional extra events).
    const statuses = value?.statuses;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      if (statuses && statuses.length > 0) {
        const s = statuses[0];
        console.log(`[whatsapp] status event: ${s.status} for msg ${s.id}`);
      } else {
        console.log("[whatsapp] webhook received (no messages, no statuses)");
      }
      return;   // 🛡️ NOT a message — do NOT call handleIncoming
    }

    const message = messages[0];
    const from = message.from;              // e.g., "919876543210"
    const type = message.type;
    const text = message.text?.body;
    const msgId = message.id;

    // 4. Log every inbound message so we can spot doubles.
    console.log(
      `[whatsapp] inbound from=${from} type=${type} id=${msgId || "?"} text="${(text || "").slice(0, 60)}"`
    );

    // 5. Non-text or empty body — ignore.
    if (type !== "text" || !text || !String(text).trim()) {
      console.log(`[whatsapp] ignoring non-text/empty message type=${type}`);
      return;   // 🛡️ NOT a usable text message — do NOT call handleIncoming
    }

    // 6. Dedup: same Meta message id twice? Skip the second.
    if (rememberMessageId(msgId)) {
      console.log(`[whatsapp] duplicate message id ${msgId}, skipping`);
      return;
    }

    // 7. Hand off to the orchestrator.
    await handleIncoming({ from, body: String(text).trim() });
  } catch (err) {
    console.error("[whatsapp] webhook failed:", err);
  }
});

export default router;