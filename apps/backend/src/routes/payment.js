import { Router } from "express";
import Trip from "../models/trip.js";
import Message from "../models/message.js";
import * as wa from "../providers/whatsapp.js";
import { FEE_INR, verifyPaymentSignature, verifyWebhookSignature } from "../providers/payment.js";
import { onPaymentConfirmed } from "../orchestrator/index.js";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────

// Escape anything that goes into the checkout HTML.
const esc = (s) =>
  String(s ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function getRazorpay() {
  const Razorpay = (await import("razorpay")).default;
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// Mark a trip as paid exactly once. /confirm and the webhook can both arrive
// for the same payment; only the first one gets the trip back, the other gets null.
async function markPaid(tripId, { paymentId, amount }) {
  return Trip.findOneAndUpdate(
    { _id: tripId, feePaid: { $ne: true } },
    { $set: { feePaid: true, feeAmount: amount, paymentId, paidAt: new Date() } },
    { new: true }
  ).populate("travelerId");
}

// Receipt on WhatsApp, then send the 3 packages (the paid flight and hotel searches start here)
// without waiting for the traveler to type anything.
async function afterPaid(trip, paymentId) {
  const traveler = trip.travelerId;
  if (!traveler?.phone) return;

  const hinglish = traveler.language === "hinglish" || traveler.language === "hi";
  const trail = `${trip.brief?.destination} (${trip.brief?.departDate} → ${trip.brief?.returnDate})`;
  const receipt = hinglish
    ? `✅ Payment mil gaya — ₹${trip.feeAmount}\n\nReceipt ID: ${paymentId}\nTrip: ${trail}\n\nAapke packages abhi bhej raha hoon.`
    : `✅ Payment received — ₹${trip.feeAmount}\n\nReceipt ID: ${paymentId}\nTrip: ${trail}\n\nSending your packages now.`;

  await wa.sendText(traveler.phone, receipt);
  await Message.create({
    travelerId: traveler._id,
    tripId: trip._id,
    direction: "out",
    body: receipt,
  });

  onPaymentConfirmed(trip._id).catch((err) => console.error("[payment] packages after payment failed:", err));
}

// ── Checkout page ────────────────────────────────────────────
// The fee is always FEE_INR from the server. Nothing the browser sends can change it.
router.get("/checkout/:tripId", async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.tripId);
    if (!trip) return res.status(404).send("Trip not found");

    const amt = FEE_INR;
    const tripId = String(trip._id);

    res.send(`
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Pay ₹${amt} — Travel Agent</title>
        <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
        <style>
          body { font-family: system-ui; background: #ece5dd; max-width: 400px; margin: 4rem auto; padding: 1rem; }
          .card { background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.1); }
          h1 { margin: 0 0 1rem; font-size: 1.25rem; color: #075e54; }
          .row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #eee; }
          .total { font-weight: 700; font-size: 1.5rem; color: #075e54; margin-top: 1rem; }
          button { width: 100%; padding: 1rem; font-size: 1rem; font-weight: 600;
                   background: #075e54; color: #fff; border: 0; border-radius: 8px; margin-top: 1.5rem; cursor: pointer; }
          button:hover { background: #128c7e; }
          button:disabled { background: #999; cursor: default; }
          .note { font-size: 0.8rem; color: #666; margin-top: 1rem; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>✈️ Travel Agent — Trip Fee</h1>
          <div class="row"><span>Destination</span><b>${esc(trip.brief?.destination)}</b></div>
          <div class="row"><span>Dates</span><b>${esc(trip.brief?.departDate)} → ${esc(trip.brief?.returnDate)}</b></div>
          <div class="row"><span>Travelers</span><b>${esc(trip.brief?.travelers)}</b></div>
          <div class="row total"><span>Total</span><span>₹${amt}</span></div>
          <button id="pay-btn" ${trip.feePaid ? "disabled" : ""}>${trip.feePaid ? "Already paid" : `Pay ₹${amt}`}</button>
          <p class="note">Secure payment via Razorpay</p>
        </div>
        <script>
          const TRIP_ID = ${JSON.stringify(tripId)};
          document.getElementById("pay-btn").addEventListener("click", async () => {
            const res = await fetch("/api/payment/create-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tripId: TRIP_ID })
            });
            const order = await res.json();
            if (order.error) { alert(order.error); return; }

            const rzp = new Razorpay({
              key: order.keyId,
              amount: order.amount * 100,
              currency: "INR",
              name: "Travel Agent",
              description: "One-time trip fee",
              order_id: order.orderId,
              handler: async (response) => {
                await fetch("/api/payment/confirm/" + TRIP_ID, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(response)
                });
                window.location.href = "/api/payment/success";
              },
              prefill: { name: "Traveler" },
              theme: { color: "#075e54" }
            });
            rzp.open();
          });
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    next(err);
  }
});

// ── Create Razorpay order (called by the checkout page) ──────
router.post("/create-order", async (req, res) => {
  try {
    const trip = await Trip.findById(req.body?.tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    if (trip.feePaid) return res.status(400).json({ error: "Already paid" });

    const rzp = await getRazorpay();
    const order = await rzp.orders.create({
      amount: FEE_INR * 100, // paise, fixed on the server
      currency: "INR",
      receipt: `trip_${trip._id}`,
      notes: { tripId: String(trip._id) },
    });

    res.json({ orderId: order.id, amount: FEE_INR, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error("[payment] create-order failed:", err);
    res.status(500).json({ error: "Could not start payment. Try again." });
  }
});

// ── Confirm payment (Razorpay handler callback from the browser) ──
router.post("/confirm/:tripId", async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    const trip = await Trip.findById(req.params.tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    if (trip.feePaid) return res.json({ ok: true, alreadyPaid: true });

    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!valid) return res.status(400).json({ error: "Invalid signature" });

    // The signed order must be OUR order for THIS trip and for the right amount
    const rzp = await getRazorpay();
    const order = await rzp.orders.fetch(razorpay_order_id);
    if (order.notes?.tripId !== String(trip._id) || order.amount !== FEE_INR * 100) {
      return res.status(400).json({ error: "Order does not match this trip" });
    }

    const paidTrip = await markPaid(trip._id, { paymentId: razorpay_payment_id, amount: FEE_INR });
    if (paidTrip) await afterPaid(paidTrip, razorpay_payment_id);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Success page ─────────────────────────────────────────────
router.get("/success", (_req, res) => {
  res.send(`
    <!doctype html><html><head><meta charset="utf-8"><title>Paid</title>
    <style>body{font-family:system-ui;background:#ece5dd;text-align:center;padding:4rem 1rem;}
    .ok{font-size:4rem;} h1{color:#075e54;}</style></head>
    <body><div class="ok">✅</div><h1>Payment Successful</h1>
    <p>Return to WhatsApp to see your packages.</p></body></html>
  `);
});

// ── Webhook (Razorpay → this server) ─────────────────────────
// Needs the RAW request body for the signature check. app.js must keep it:
//   app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
router.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];

    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      console.error("[razorpay webhook] RAZORPAY_WEBHOOK_SECRET is not set; rejecting");
      return res.status(503).json({ error: "Webhook not configured" });
    }
    if (!req.rawBody || !signature || !verifyWebhookSignature(req.rawBody, signature)) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = req.body?.event;
    const payment = req.body?.payload?.payment?.entity;

    if (event === "payment.captured" && payment?.notes?.tripId && payment.amount === FEE_INR * 100) {
      const paidTrip = await markPaid(payment.notes.tripId, { paymentId: payment.id, amount: payment.amount / 100 });
      if (paidTrip) await afterPaid(paidTrip, payment.id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[razorpay webhook] failed:", err);
    res.status(500).json({ ok: false }); // 500 makes Razorpay retry; markPaid makes retries safe
  }
});

export default router;