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

// Meta sends POST for every incoming message.
router.post("/meta", async (req, res) => {
  // Respond 200 immediately — Meta requires it within a few seconds.
  res.sendStatus(200);

  try {
    // Verify the signature (Meta signs the raw body with your app secret).
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

    // Extract the message from Meta's deeply nested payload.
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from;              // e.g., "919876543210"
    const type = message.type;
    const text = message.text?.body;

    if (type !== "text" || !text) {
      console.log(`[whatsapp] ignoring non-text message type: ${type}`);
      return;
    }

    console.log(`[whatsapp] inbound (${String(from).slice(0, 2)}******): ${text.length} chars`);

    await handleIncoming({ from, body: String(text).trim() });
  } catch (err) {
    console.error("[whatsapp] webhook failed:", err);
  }
});

export default router;