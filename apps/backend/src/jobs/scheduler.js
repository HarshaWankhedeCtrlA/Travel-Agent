import cron from "node-cron";
import Trip from "../models/trip.js";
import { runPriceCheck, checkFrequency } from "../services/price-watch.js";

let running = false;

// PRD §6: batch by route+date — here we just enqueue per trip, provider layer caches
async function tick() {
  if (running) return;
  running = true;

  try {
    const trips = await Trip.find({
      status: { $in: ["ITINERARY_SENT", "WATCHING"] },
      feePaid: true,
      paused: false,
      watchPaused: false,
    }).limit(500);

    const now = Date.now();
    let checked = 0;
    let sent = 0;

    for (const trip of trips) {
      const daysToDeparture = Math.ceil(
        (new Date(trip.brief?.departDate || 0) - new Date()) / 86400000
      );
      if (daysToDeparture < 0) continue;

      const freq = checkFrequency(daysToDeparture);
      const lastChecked = trip.lastCheckedAt ? trip.lastCheckedAt.getTime() : 0;
      if (now - lastChecked < freq) continue;

      const result = await runPriceCheck(trip._id.toString());
      checked++;
      if (result.sent) sent++;
    }

    if (checked > 0) {
      console.log(`[scheduler] checked ${checked} trips, sent ${sent} alerts`);
    }
  } catch (err) {
    console.error("[scheduler] tick failed:", err.message);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  // Every hour at minute 5
  cron.schedule("5 * * * *", tick);

  // First run 60 seconds after boot
  setTimeout(tick, 60 * 1000);

  console.log("[scheduler] started — runs hourly");
}