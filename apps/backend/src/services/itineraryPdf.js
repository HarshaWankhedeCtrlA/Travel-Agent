// Renders the itinerary as a PDF using pdfkit.
// No headless browser — fast, small, deterministic.

import PDFDocument from "pdfkit";

function inr(n) {
  if (n == null) return "—";
  return `Rs. ${Number(n).toLocaleString("en-IN")}`;
}

export function streamItineraryPdf(trip, res) {
  const b = trip.brief || {};
  const itin = trip.itinerary || {};
  const pkg = (trip.packages || []).find((p) => p.tier === trip.chosenTier) || trip.packages?.[0] || {};

  const doc = new PDFDocument({ size: "A4", margin: 50 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="itinerary-${trip._id}.pdf"`
  );
  doc.pipe(res);

  // ── Header ─────────────────────────────────────────────
  doc.fontSize(22).fillColor("#0a7c66").text(b.destination || "Your trip");
  const dates = b.departDate && b.returnDate ? `${b.departDate} → ${b.returnDate}` : "";
  if (dates) doc.fontSize(11).fillColor("#6b7280").text(dates);
  doc.moveDown(1);

  // ── Flight ─────────────────────────────────────────────
  const flight = pkg.flight || {};
  if (flight.airline) {
    doc.fontSize(13).fillColor("#111827").text("Flight", { underline: false });
    doc.fontSize(11).fillColor("#374151").text(
      `${flight.airline} ${flight.flightNumber || ""}`.trim()
    );
    if (flight.route || flight.duration) {
      doc.fontSize(10).fillColor("#6b7280").text(
        [flight.route, flight.duration].filter(Boolean).join(" · ")
      );
    }
    doc.moveDown(0.8);
  }

  // ── Hotel ──────────────────────────────────────────────
  const hotel = pkg.hotel || {};
  if (hotel.name) {
    doc.fontSize(13).fillColor("#111827").text("Stay");
    doc.fontSize(11).fillColor("#374151").text(hotel.name);
    const meta = [
      hotel.rating ? `${hotel.rating} star` : null,
      hotel.guestRating ? `${hotel.guestRating}/5` : null,
      hotel.distanceFromCenter || null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (meta) doc.fontSize(10).fillColor("#6b7280").text(meta);
    if (hotel.pricePerNight) {
      doc.fontSize(10).fillColor("#6b7280").text(`${inr(hotel.pricePerNight)}/night`);
    }
    doc.moveDown(0.8);
  }

  // ── Budget ─────────────────────────────────────────────
  if (pkg.totalPrice) {
    doc.fontSize(13).fillColor("#111827").text("Budget");
    doc.fontSize(11).fillColor("#374151").text(`Package: ${inr(pkg.totalPrice)}`);
    if (b.budget) {
      doc.fontSize(10).fillColor("#6b7280").text(`Your budget: ${inr(b.budget)}`);
      if (pkg.totalPrice > b.budget) {
        doc.fillColor("#b91c1c").text(`Over budget by ${inr(pkg.totalPrice - b.budget)}`);
      }
    }
    doc.moveDown(0.8);
  }

  // ── Days ───────────────────────────────────────────────
  if (Array.isArray(itin.days) && itin.days.length) {
    doc.fontSize(13).fillColor("#111827").text("Day-by-day");
    doc.moveDown(0.3);
    for (const day of itin.days) {
      doc.fontSize(11).fillColor("#0a7c66").text(day.title || `Day ${day.n}`);
      const lines = [
        ["Morning", day.morning],
        ["Afternoon", day.afternoon],
        ["Evening", day.evening],
      ].filter(([, v]) => v && String(v).trim());
      for (const [label, value] of lines) {
        doc.fontSize(10).fillColor("#374151").text(`${label}: ${value}`, { indent: 12 });
      }
      if (Array.isArray(day.notes) && day.notes.length) {
        for (const n of day.notes) {
          doc.fontSize(9).fillColor("#6b7280").text(`• ${n}`, { indent: 12 });
        }
      }
      doc.moveDown(0.5);
    }
  }

  // ── Packing ────────────────────────────────────────────
  if (Array.isArray(itin.packing) && itin.packing.length) {
    doc.fontSize(13).fillColor("#111827").text("Packing");
    doc.fontSize(10).fillColor("#374151").text(itin.packing.join(", "));
    doc.moveDown(0.8);
  }

  // ── Documents ──────────────────────────────────────────
  if (Array.isArray(itin.documents) && itin.documents.length) {
    doc.fontSize(13).fillColor("#111827").text("Documents");
    doc.fontSize(10).fillColor("#374151").text(itin.documents.join(", "));
    doc.moveDown(0.8);
  }

  // ── Footer ─────────────────────────────────────────────
  const pages = doc.bufferedPageRange ? doc.bufferedPageRange() : null;   // ignore if not available
  doc.fontSize(8).fillColor("#9ca3af").text(
    `Prepared by Travel Assistant · Trip ID ${trip._id}`,
    50,
    doc.page.height - 40,
    { align: "center", width: doc.page.width - 100 }
  );

  doc.end();
}