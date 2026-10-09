import { Router } from "express";
import { handleIncoming } from "../orchestrator/index.js";
import { drainOutbox } from "../providers/whatsapp.js";

const router = Router();

// Chat-mock posts here
router.post("/mock", async (req, res, next) => {
  try {
    const { from, body } = req.body;
    if (!from || !body) {
      return res.status(400).json({ error: "from and body are required" });
    }
    const result = await handleIncoming({ from, body });
    const replies = drainOutbox(from);
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