import { Router } from "express";
import crypto from "node:crypto";
import Trip from "../models/trip.js";
import Message from "../models/message.js";
import * as wa from "../providers/whatsapp.js";
import { FEE_INR, verifyPaymentSignature } from "../providers/payment.js";

const router = Router();

// Checkout page — loads Razorpay's official hosted checkout
router.get("/checkout/:tripId", async (req, res, next) => {
  try {
    const { order_id, amount } = req.query;
    const trip = await Trip.findById(req.params.tripId);
    if (!trip) return res.status(404).send("Trip not found");

    const keyId = process.env.RAZORPAY_KEY_ID;
    const amt = Number(amount) || FEE_INR;

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
          .note { font-size: 0.8rem; color: #666; margin-top: 1rem; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>✈️ Travel Agent — Trip Fee</h1>
          <div class="row"><span>Destination</span><b>${trip.brief?.destination || "—"}</b></div>
          <div class="row"><span>Dates</span><b>${trip.brief?.departDate} → ${trip.brief?.returnDate}</b></div>
          <div class="row"><span>Travelers</span><b>${trip.brief?.travelers}</b></div>
          <div class="row total"><span>Total</span><span>₹${amt}</span></div>
          <button id="pay-btn">Pay ₹${amt}</button>
          <p class="note">Secure payment via Razorpay</p>
        </div>
        <script>
          document.getElementById("pay-btn").addEventListener("click", async () => {
            const res = await fetch("/api/payment/create-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tripId: "${trip._id}", amount: ${amt} })
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
                await fetch("/api/payment/confirm/${trip._id}", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(response)
                });
                window.location.href = "/api/payment/success";
              },
              prefill: { name: "Traveler", email: "test@example.com" },
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

// Create Razorpay order (called by checkout page)
router.post("/create-order", async (req, res, next) => {
  try {
    const { tripId, amount } = req.body;
    const Razorpay = (await import("razorpay")).default;
    const rzp = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await rzp.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: `trip_${tripId}`,
      notes: { tripId: String(tripId) },
    });

    res.json({
      orderId: order.id,
      amount: amount,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    next(err);
  }
});

// Confirm payment (Razorpay handler callback)
router.post("/confirm/:tripId", async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const trip = await Trip.findById(req.params.tripId).populate("travelerId");
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    if (trip.feePaid) return res.json({ ok: true, alreadyPaid: true });

    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!valid) return res.status(400).json({ error: "Invalid signature" });

    trip.feePaid = true;
    trip.feeAmount = FEE_INR;
    trip.paymentId = razorpay_payment_id;
    trip.paidAt = new Date();
    await trip.save();

    const traveler = trip.travelerId;
    if (traveler?.phone) {
      const receipt =
        `✅ Payment received — ₹${FEE_INR}\n\n` +
        `Receipt ID: ${razorpay_payment_id}\n` +
        `Trip: ${trip.brief?.destination} (${trip.brief?.departDate} → ${trip.brief?.returnDate})\n\n` +
        `Reply "paid" to build your itinerary.`;
      await wa.sendText(traveler.phone, receipt);
      await Message.create({
        travelerId: traveler._id,
        tripId: trip._id,
        direction: "out",
        body: receipt,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Success page
router.get("/success", (_req, res) => {
  res.send(`
    <!doctype html><html><head><meta charset="utf-8"><title>Paid</title>
    <style>body{font-family:system-ui;background:#ece5dd;text-align:center;padding:4rem 1rem;}
    .ok{font-size:4rem;} h1{color:#075e54;}</style></head>
    <body><div class="ok">✅</div><h1>Payment Successful</h1>
    <p>Return to WhatsApp to see your itinerary.</p></body></html>
  `);
});

// Real webhook (for later — Razorpay → your server on payment events)
router.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const body = JSON.stringify(req.body);

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (secret && signature) {
      const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
      if (expected !== signature) return res.status(400).json({ error: "Invalid signature" });
    }

    // Handle payment.captured events
    const event = req.body?.event;
    const payment = req.body?.payload?.payment?.entity;
    if (event === "payment.captured" && payment?.notes?.tripId) {
      const trip = await Trip.findById(payment.notes.tripId).populate("travelerId");
      if (trip && !trip.feePaid) {
        trip.feePaid = true;
        trip.feeAmount = payment.amount / 100;
        trip.paymentId = payment.id;
        trip.paidAt = new Date();
        await trip.save();
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[razorpay webhook] failed:", err);
    res.json({ ok: false });
  }
});

export default router;