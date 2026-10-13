import mongoose from "mongoose";

const travelerSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    name: { type: String },
    language: { type: String, default: "en" },

    // STOP / START (PRD section 11 commands, section 13 consent)
    optedOut: { type: Boolean, default: false },
    optedOutAt: { type: Date },

    // First-message disclosure (PRD section 11 flow F1 and section 13):
    // "I am an AI assistant", what it does, what it costs. Shown once per traveler.
    introduced: { type: Boolean, default: false },
    // When the traveler was shown the intro and carried on (consent to messaging and AI processing)
    consentAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("Traveler", travelerSchema);