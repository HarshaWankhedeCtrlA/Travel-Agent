import { Router } from "express";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { Trip } from "../models/trip.js";

// Admin-only trip API. Travelers never use this; they talk to the bot on WhatsApp.
// It was open to anyone before, which let a caller read every traveler's trip and
// PATCH { feePaid: true } to skip the fee. Now every route needs the key below.
//
//   .env:    ADMIN_API_KEY=<long random string>
//   request: header  x-admin-key: <that string>

const router = Router();

function adminOnly(req, res, next) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) return res.status(503).json({ error: "Admin API is off (ADMIN_API_KEY is not set)" });

  const given = Buffer.from(req.get("x-admin-key") || "");
  const expected = Buffer.from(key);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.use(adminOnly);

// Only these fields can be written from outside. Payment and flow fields
// (feePaid, feeAmount, paymentId, status, brief, packages, itinerary...) are
// changed by the bot and the payment route only.
const EDITABLE = ["title", "destination", "startDate", "endDate", "budget"];

function pickEditable(body = {}) {
  const out = {};
  for (const k of EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  // The one status change allowed from here: cancelling a trip
  if (body.status === "CANCELLED") out.status = "CANCELLED";
  return out;
}

// Express 4 does not catch errors from async handlers by itself
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validId(req, res) {
  if (mongoose.isValidObjectId(req.params.id)) return true;
  res.status(400).json({ error: "Invalid trip ID" });
  return false;
}

router.get(
  "/",
  wrap(async (_req, res) => {
    const trips = await Trip.find().sort({ updatedAt: -1 }).limit(100);
    res.json(trips);
  })
);

router.post(
  "/",
  wrap(async (req, res) => {
    const trip = await Trip.create(pickEditable(req.body));
    res.status(201).json(trip);
  })
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.json(trip);
  })
);

router.patch(
  "/:id",
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const trip = await Trip.findByIdAndUpdate(
      req.params.id,
      { $set: pickEditable(req.body) },
      { new: true, runValidators: true }
    );
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.json(trip);
  })
);

router.delete(
  "/:id",
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const trip = await Trip.findByIdAndDelete(req.params.id);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.status(204).end();
  })
);

export default router;