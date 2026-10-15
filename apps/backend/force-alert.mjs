import mongoose from "mongoose";
import "dotenv/config";

// 🔧 Register ALL models used by populate() — order matters!
import Traveler from "./src/models/traveler.js";
import Trip from "./src/models/trip.js";
import Message from "./src/models/message.js";
import PriceAlert from "./src/models/price-alert.js";

import { runPriceCheck } from "./src/services/price-watch.js";

await mongoose.connect(process.env.MONGODB_URI);
console.log("✅ DB connected");

const trip = await Trip.findById("6ad08e57ad4d39e229c94e9b");
if (!trip) {
  console.error("❌ Trip not found");
  process.exit(1);
}

console.log("Trip:", trip._id);
console.log("  →", trip.brief.destination);
console.log("  status:", trip.status);
console.log("  watchPaused:", trip.watchPaused);
console.log("  paused:", trip.paused);
console.log("  baselinePrice:", trip.baselinePrice);
// await PriceAlert.deleteMany({ tripId: trip._id });
// console.log("🧹 Cleared old alerts");
console.log("⚠️ Not clearing alerts — testing rate limit");

// Save the real baseline so we can restore it after
const realBaseline = trip.baselinePrice || 50000;
console.log("📊 Real baseline:", realBaseline);

// Fake a higher baseline (in-memory, not saved) — need to save for runPriceCheck to see it
trip.baselinePrice = Math.round(realBaseline * 1.4);
await trip.save();
console.log("📊 Fake baseline (saved):", trip.baselinePrice);

// Run the check
const result = await runPriceCheck(trip._id.toString());
console.log("\n📊 Result:", JSON.stringify(result, null, 2));

// 🔙 Restore the real baseline
trip.baselinePrice = realBaseline;
await trip.save();
console.log("🔙 Restored baseline to:", realBaseline);

await mongoose.disconnect();
console.log("\n✅ Done");