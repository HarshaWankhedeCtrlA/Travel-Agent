import mongoose from "mongoose";
import "dotenv/config";
import Traveler from "./src/models/traveler.js";
import Trip from "./src/models/trip.js";
import Message from "./src/models/message.js";
import PriceAlert from "./src/models/price-alert.js";
import { runPriceCheck } from "./src/services/price-watch.js";

const TRIP_ID = "6ad09e365fc7a4daa52a6033";
await mongoose.connect(process.env.MONGODB_URI);
console.log("✅ DB connected");

const trip = await Trip.findById(TRIP_ID);
if (!trip) { console.error("❌ Trip not found"); process.exit(1); }

console.log("Trip:", trip._id, "→", trip.brief.destination);
console.log("  status:", trip.status);
console.log("  watchPaused:", trip.watchPaused);
console.log("  baselinePrice:", trip.baselinePrice);
console.log("  budget:", trip.brief?.budget);

// Clear old alerts so rate limit doesn't block
await PriceAlert.deleteMany({ tripId: trip._id });
console.log("🧹 Cleared old alerts");

// Save real baseline, set fake high one
const realBaseline = trip.baselinePrice || 50000;
trip.baselinePrice = Math.round(realBaseline * 1.4);
await trip.save();
console.log("📊 Fake baseline:", trip.baselinePrice, "(real:", realBaseline + ")");

// Run the check — sends real WhatsApp alert
const result = await runPriceCheck(trip._id.toString());
console.log("\n📊 Result:", JSON.stringify(result, null, 2));

// Restore baseline
trip.baselinePrice = realBaseline;
await trip.save();
console.log("🔙 Restored baseline to:", realBaseline);

await mongoose.disconnect();
console.log("\n✅ Done");