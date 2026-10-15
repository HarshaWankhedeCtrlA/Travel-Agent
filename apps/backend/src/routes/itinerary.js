// Public itinerary routes — HTML page + PDF download.
// Access is gated by trip.shareToken (?t=...).

import { Router } from "express";
import { resolveTrip } from "../middleware/resolveTrip.js";
import { renderItineraryPage } from "../services/itineraryPage.js";
import { streamItineraryPdf } from "../services/itineraryPdf.js";

const router = Router();

// GET /itinerary/:tripId?t=token   → HTML page
router.get("/:tripId", resolveTrip, (req, res) => {
  try {
    const html = renderItineraryPage(req.trip);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("[itinerary] page render failed:", err);
    res.status(500).send("Could not render itinerary");
  }
});

// GET /itinerary/:tripId.pdf?t=token   → PDF download
router.get("/:tripId/pdf", resolveTrip, (req, res) => {
  try {
    streamItineraryPdf(req.trip, res);
  } catch (err) {
    console.error("[itinerary] pdf render failed:", err);
    if (!res.headersSent) res.status(500).send("Could not render PDF");
  }
});

export default router;