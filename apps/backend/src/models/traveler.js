import mongoose from "mongoose";

const travelerSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    name: { type: String },
    language: { type: String, default: "en" },
    optedOut: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Traveler", travelerSchema);