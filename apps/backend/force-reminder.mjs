// Test script — force a reminder for a specific trip
// Usage:
//   node force-reminder.mjs 7d     # simulate 7-day reminder
//   node force-reminder.mjs 1d     # simulate 1-day reminder
//   node force-reminder.mjs 7d 1d  # both
//   node force-reminder.mjs clear  # reset remindersSent on the trip

import mongoose from "mongoose";
import "dotenv/config";
import Traveler from "./src/models/traveler.js";
import Trip from "./src/models/trip.js";
import Message from "./src/models/message.js";
import { runRemindersForTrip, daysToDeparture } from "./src/services/reminders.js";

const TRIP_ID = "6ad08e57ad4d39e229c94e9b";

await mongoose.connect(process.env.MONGODB_URI);
console.log("✅ DB connected");

const args = process.argv.slice(2);
if (args.includes("clear")) {
  await Trip.updateOne({ _id: TRIP_ID }, { $set: { remindersSent: [] } });
  console.log("🧹 Cleared remindersSent on trip");
  await mongoose.disconnect();
  process.exit(0);
}

const trip = await Trip.findById(TRIP_ID);
if (!trip) { console.error("❌ Trip not found"); process.exit(1); }

console.log("Trip:", trip._id, "→", trip.brief?.destination);
console.log("  departDate:", trip.brief?.departDate);
console.log("  daysToDeparture:", daysToDeparture(trip.brief?.departDate));
console.log("  remindersSent:", trip.remindersSent);

// Simulate a departure so the reminder is due
//   "7d" → set departDate to 6 days from now (within the 7-day window)
//   "1d" → set departDate to 1 day from now
if (args.includes("7d")) {
  const d = new Date(Date.now() + 6 * 86400000);
  trip.brief.departDate = d.toISOString().slice(0, 10);
  trip.markModified("brief");
  await trip.save();
  console.log("📅 Set departDate to", trip.brief.departDate, "(for 7d test)");
}
if (args.includes("1d")) {
  const d = new Date(Date.now() + 1 * 86400000);
  trip.brief.departDate = d.toISOString().slice(0, 10);
  trip.markModified("brief");
  await trip.save();
  console.log("📅 Set departDate to", trip.brief.departDate, "(for 1d test)");
}

const result = await runRemindersForTrip(TRIP_ID);
console.log("\n📊 Result:", JSON.stringify(result, null, 2));

await mongoose.disconnect();
console.log("\n✅ Done");