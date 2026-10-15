// Loads a trip by :tripId, verifies the shareToken from ?t=
// Attaches req.trip on success, 404s otherwise.

import Trip from "../models/trip.js";

export async function resolveTrip(req, res, next) {
  try {
    const { tripId } = req.params;
    const token = req.query.t;

    if (!tripId || !/^[a-f\d]{24}$/i.test(tripId)) {
      return res.status(404).send("Not found");
    }
    if (!token || typeof token !== "string") {
      return res.status(404).send("Not found");
    }

    const trip = await Trip.findById(tripId);
    if (!trip) return res.status(404).send("Not found");
    if (trip.shareEnabled === false) return res.status(404).send("Not found");
    if (!trip.shareToken || trip.shareToken !== token) {
      return res.status(404).send("Not found");
    }
    if (!trip.itinerary) return res.status(404).send("Itinerary not ready yet");

    req.trip = trip;
    next();
  } catch (err) {
    console.error("[itinerary] resolveTrip failed:", err.message);
    return res.status(404).send("Not found");
  }
}