import { Router } from "express";
import { handleIncoming } from "../orchestrator/index.js";
import { drainOutbox } from "../providers/whatsapp.js";

const router = Router();

// The mock chat is for local testing only. With real WhatsApp (meta), these
// routes are off, because anyone could otherwise send a message as any phone number.
const mockEnabled = () => (process.env.WHATSAPP_PROVIDER || "mock").toLowerCase() === "mock";
router.use(["/mock", "/outbox"], (_req, res, next) => (mockEnabled() ? next() : res.sendStatus(404)));

// Chat-mock posts here
router.post("/mock", async (req, res, next) => {
  try {
    console.log(`\n>>> [mock] POST hit — from=${req.body?.from} body="${req.body?.body}"`);

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

export default router;