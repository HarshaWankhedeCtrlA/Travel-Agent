import mongoose from "mongoose";

const priceAlertSchema = new mongoose.Schema(
  {
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true, index: true },
    type: {
      type: String,
      enum: ["GOOD_PRICE", "RISING_SOON", "BETTER_OPTION", "SOLD_OUT", "BOOKED_DROP"],
      required: true,
    },
    price: { type: Number, required: true },
    change: { type: Number, default: 0 }, // +/- from baseline
    changePct: { type: Number, default: 0 },
    payload: { type: mongoose.Schema.Types.Mixed },
    sentAt: { type: Date, default: Date.now, index: true },
    openedAt: { type: Date },
    action: { type: String, enum: ["book", "wait", "pause"] },
  },
  { timestamps: true }
);

// Fast lookup for rate limits: alerts for a trip in the last N days
priceAlertSchema.index({ tripId: 1, sentAt: -1 });

export default mongoose.model("PriceAlert", priceAlertSchema);