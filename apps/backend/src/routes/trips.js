import { Router } from "express";
import mongoose from "mongoose";
import { Trip } from "../models/trip.js";

const router = Router();

router.get("/", async (_req, res) => {
  const trips = await Trip.find().sort({ startDate: 1 });
  res.json(trips);
});

router.post("/", async (req, res) => {
  const trip = await Trip.create(req.body);
  res.status(201).json(trip);
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: "Invalid trip ID" });
  }

  const trip = await Trip.findById(req.params.id);
  if (!trip) {
    return res.status(404).json({ error: "Trip not found" });
  }

  res.json(trip);
});

router.patch("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: "Invalid trip ID" });
  }

  const trip = await Trip.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!trip) {
    return res.status(404).json({ error: "Trip not found" });
  }

  res.json(trip);
});

router.delete("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: "Invalid trip ID" });
  }

  const trip = await Trip.findByIdAndDelete(req.params.id);
  if (!trip) {
    return res.status(404).json({ error: "Trip not found" });
  }

  res.status(204).end();
});

export default router;
