// Daily reminder scheduler — runs at 9am local time.
// For each active trip, checks if any pre-trip reminder is due
// and sends it via WhatsApp.

import cron from "node-cron";
import Trip from "../models/trip.js";
import { runRemindersForTrip } from "./reminders.js";

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    // Only trips that are confirmed and not paused
    const trips = await Trip.find({
      status: { $in: ["ITINERARY_SENT", "BOOKED"] },
      paused: false,
    }).limit(500);

    let checked = 0;
    let sent = 0;

    for (const trip of trips) {
      checked++;
      try {
        const result = await runRemindersForTrip(trip._id.toString());
        if (result.sent?.length) sent += result.sent.length;
      } catch (err) {
        console.error(`[reminders] trip ${trip._id} failed:`, err.message);
      }
    }

    if (checked > 0) {
      console.log(`[reminders] checked ${checked} trips, sent ${sent} reminders`);
    }
  } catch (err) {
    console.error("[reminders] tick failed:", err.message);
  } finally {
    running = false;
  }
}

export function startReminderScheduler() {
  // Every day at 9:00am server time
  cron.schedule("0 9 * * *", tick);

  // First run 90 seconds after boot (after price-watch first tick)
  setTimeout(tick, 90 * 1000);

  console.log("[reminders] scheduler started — runs daily at 9am");
}