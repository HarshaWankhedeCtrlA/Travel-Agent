import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    travelerId: { type: mongoose.Schema.Types.ObjectId, ref: "Traveler", index: true },
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", index: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    body: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model("Message", messageSchema);