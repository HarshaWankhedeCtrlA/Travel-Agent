import { Router } from "express";
import { handleIncoming } from "../orchestrator/index.js";
import { drainOutbox } from "../providers/whatsapp.js";

const router = Router();

// The mock chat is for local testing only. With real WhatsApp (twilio) these
// routes are off, because anyone could otherwise send a message as any phone number.
const mockEnabled = () => (process.env.WHATSAPP_PROVIDER || "mock").toLowerCase() !== "twilio";
router.use(["/mock", "/outbox"], (_req, res, next) => (mockEnabled() ? next() : res.sendStatus(404)));

// Chat-mock posts here
router.post("/mock", async (req, res, next) => {
  try {
    // req.body is undefined (not {}) when the request has no JSON body or no
    // "Content-Type: application/json" header, so read it safely.
    const { from, body } = req.body || {};
    if (!from || !body) {
      return res.status(400).json({
        error: 'Send JSON like {"from":"9876543210","body":"hi"} with header Content-Type: application/json',
      });
    }
    const phone = String(from);
    const result = await handleIncoming({ from: phone, body: String(body) });
    const replies = drainOutbox(phone);
    res.json({ ok: true, ...result, replies });
  } catch (err) {
    next(err);
  }
});

// Optional: poll for pending outbound messages
router.get("/outbox/:phone", (req, res) => {
  res.json({ messages: drainOutbox(req.params.phone) });
});

// Meta Cloud API verification (unused for now, but ready)
router.get("/", (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "dev-verify-token";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

export default router;