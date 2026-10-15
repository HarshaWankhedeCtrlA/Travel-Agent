import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import tripsRouter from "./routes/trips.js";
import webhookRouter from "./routes/webhook.js";
import paymentRouter from "./routes/payment.js";
import whatsappRouter from "./routes/whatsapp.js";
import itineraryRouter from "./routes/itinerary.js";
const app = express();

app.use(cors());
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.use("/api/trips", tripsRouter);
app.use("/api/webhook", webhookRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/itinerary", itineraryRouter);
app.use((err, _req, res, _next) => {
  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: "A record with these values already exists" });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;