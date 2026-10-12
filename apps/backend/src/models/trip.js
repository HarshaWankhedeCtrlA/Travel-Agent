import mongoose from "mongoose";

const tripSchema = new mongoose.Schema(
  {
    // Original fields (keep for compatibility)
    title: { type: String, trim: true },
    destination: { type: String, trim: true },
    startDate: { type: Date },
    endDate: { type: Date },
    budget: { type: Number, min: 0 },

    // Bot fields
    travelerId: { type: mongoose.Schema.Types.ObjectId, ref: "Traveler", index: true },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "BRIEF_CONFIRMED",
        "PREVIEW_SENT",
        "FEE_PAID",
        "PACKAGES_SENT",
        "ITINERARY_SENT",
        "WATCHING",
        "BOOKED",
        "CANCELLED",
      ],
      default: "DRAFT",
      index: true,
    },
    brief: { type: mongoose.Schema.Types.Mixed, default: {} },
    packages: { type: [mongoose.Schema.Types.Mixed], default: [] },
chosenTier: { type: String },
itinerary: { type: mongoose.Schema.Types.Mixed, default: null },
feePaid: { type: Boolean, default: false },
feeAmount: { type: Number },
paymentId: { type: String },
paidAt: { type: Date },
  },
  { timestamps: true }
);

export const Trip = mongoose.model("Trip", tripSchema);
export default Trip;