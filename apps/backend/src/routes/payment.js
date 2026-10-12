import { Router } from "express";
import Trip from "../models/trip.js";
import Message from "../models/message.js";
import Traveler from "../models/traveler.js";
import * as wa from "../providers/whatsapp.js";
import { FEE_INR } from "../providers/payment.js";

const router = Router();

// Mock checkout page — clicking "Pay" simulates a successful payment
router.get("/checkout/:tripId", async (req, res, next) => {
  try {
    const { id: paymentId, amount } = req.query;
    const trip = await Trip.findById(req.params.tripId);
    if (!trip) return res.status(404).send("Trip not found");

    res.send(`
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Pay ₹${amount || FEE_INR} — Travel Agent</title>
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
          <div class="row total"><span>Total</span><span>₹${amount || FEE_INR}</span></div>
          <form method="POST" action="/api/payment/confirm/${trip._id}">
            <input type="hidden" name="paymentId" value="${paymentId || "mock_pay"}" />
            <input type="hidden" name="amount" value="${amount || FEE_INR}" />
            <button type="submit">Pay ₹${amount || FEE_INR}</button>
          </form>
          <p class="note">This is a mock checkout for development. No real payment is processed.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    next(err);
  }
});

// Mock confirmation — marks the trip as paid and sends itinerary
router.post("/confirm/:tripId", async (req, res, next) => {
  try {
    const { paymentId, amount } = req.body;
    const trip = await Trip.findById(req.params.tripId).populate("travelerId");
    if (!trip) return res.status(404).send("Trip not found");

    trip.feePaid = true;
    trip.feeAmount = Number(amount) || FEE_INR;
    trip.paymentId = paymentId;
    trip.paidAt = new Date();
    await trip.save();

    const traveler = trip.travelerId;
    const phone = traveler?.phone;

    if (phone) {
      const receipt =
        `✅ Payment received — ₹${trip.feeAmount}\n\n` +
        `Receipt ID: ${paymentId}\n` +
        `Trip: ${trip.brief?.destination} (${trip.brief?.departDate} → ${trip.brief?.returnDate})\n\n` +
        `Now building your itinerary...`;
      await wa.sendText(phone, receipt);
      await Message.create({
        travelerId: traveler._id,
        tripId: trip._id,
        direction: "out",
        body: receipt,
      });
    }

    res.send(`
      <!doctype html>
      <html><head><meta charset="utf-8"><title>Paid</title>
      <style>body{font-family:system-ui;background:#ece5dd;text-align:center;padding:4rem 1rem;}
      .ok{font-size:4rem;} h1{color:#075e54;}</style></head>
      <body>
        <div class="ok">✅</div>
        <h1>Payment Successful</h1>
        <p>Return to WhatsApp to see your itinerary.</p>
      </body></html>
    `);
  } catch (err) {
    next(err);
  }
});

// Real webhook (for later — Razorpay/Cashfree)
router.post("/webhook", async (req, res) => {
  // TODO: verify signature, mark trip paid, trigger itinerary
  res.json({ ok: true });
});

export default router;