// Renders the itinerary as a mobile-friendly HTML page.
// Everything inline — no external assets, no build step.

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inr(n) {
  if (n == null) return "—";
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

function renderDay(day) {
  const rows = [
    ["🌅", "Morning", day.morning],
    ["☀️", "Afternoon", day.afternoon],
    ["🌙", "Evening", day.evening],
  ]
    .filter(([, , v]) => v && String(v).trim())
    .map(
      ([icon, label, v]) =>
        `<div class="row"><span class="icon">${icon}</span><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(v)}</span></div>`
    )
    .join("");

  const notes = Array.isArray(day.notes)
    ? day.notes.map((n) => `<div class="note">• ${escapeHtml(n)}</div>`).join("")
    : "";

  return `
    <section class="day">
      <h3>${escapeHtml(day.title || `Day ${day.n}`)}</h3>
      ${rows}
      ${notes}
    </section>
  `;
}

export function renderItineraryPage(trip) {
  const b = trip.brief || {};
  const itin = trip.itinerary || {};
  const pkg = (trip.packages || []).find((p) => p.tier === trip.chosenTier) || trip.packages?.[0] || {};

  const dest = escapeHtml(b.destination || "Your trip");
  const dates = b.departDate && b.returnDate
    ? `${escapeHtml(b.departDate)} → ${escapeHtml(b.returnDate)}`
    : "";

  const daysHtml = (itin.days || []).map(renderDay).join("");

  const packing = Array.isArray(itin.packing)
    ? itin.packing.map((p) => `<li>${escapeHtml(p)}</li>`).join("")
    : "";

  const documents = Array.isArray(itin.documents)
    ? itin.documents.map((p) => `<li>${escapeHtml(p)}</li>`).join("")
    : "";

  const flight = pkg.flight || {};
  const hotel = pkg.hotel || {};

const pdfUrl = `/itinerary/${trip._id}/pdf?t=${encodeURIComponent(trip.shareToken)}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${dest} — Itinerary</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0; padding: 0; background: #f5f5f5; color: #1f2937;
      line-height: 1.5; -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 640px; margin: 0 auto; background: #fff; min-height: 100vh; }
    header {
      background: linear-gradient(135deg, #0a7c66 0%, #0f9d80 100%);
      color: #fff; padding: 24px 20px;
    }
    header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
    header p { margin: 0; opacity: 0.9; font-size: 14px; }
    .section { padding: 20px; border-bottom: 1px solid #e5e7eb; }
    .section:last-child { border-bottom: none; }
    .section h2 { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
    .card { background: #f9fafb; border-radius: 10px; padding: 14px; margin-bottom: 10px; }
    .card .k { font-size: 15px; font-weight: 600; color: #111827; }
    .card .v { font-size: 13px; color: #4b5563; margin-top: 4px; }
    .day { margin-bottom: 16px; }
    .day h3 { margin: 0 0 8px; font-size: 15px; color: #0a7c66; }
    .row { display: flex; gap: 8px; padding: 6px 0; font-size: 14px; border-bottom: 1px dashed #e5e7eb; }
    .row:last-child { border-bottom: none; }
    .icon { flex: 0 0 auto; }
    .label { flex: 0 0 80px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3px; padding-top: 2px; }
    .value { flex: 1; color: #111827; }
    .note { font-size: 12px; color: #6b7280; padding-left: 8px; margin-top: 4px; }
    ul { margin: 0; padding-left: 20px; font-size: 14px; }
    li { margin-bottom: 4px; }
    .warn { color: #b91c1c; font-weight: 600; }
    .actions { display: flex; gap: 10px; padding: 20px; }
    .btn {
      flex: 1; display: inline-block; text-align: center; text-decoration: none;
      background: #0a7c66; color: #fff; padding: 12px; border-radius: 8px;
      font-weight: 600; font-size: 14px;
    }
    .btn.secondary { background: #e5e7eb; color: #111827; }
    footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${dest}</h1>
      ${dates ? `<p>${dates}</p>` : ""}
    </header>

    ${
      flight.airline
        ? `<section class="section">
            <h2>Flight</h2>
            <div class="card">
              <div class="k">${escapeHtml(flight.airline)} ${escapeHtml(flight.flightNumber || "")}</div>
              <div class="v">${escapeHtml(flight.route || "")} ${flight.duration ? "· " + escapeHtml(flight.duration) : ""}</div>
              ${flight.departTime ? `<div class="v">Departs ${escapeHtml(flight.departTime)}</div>` : ""}
            </div>
          </section>`
        : ""
    }

    ${
      hotel.name
        ? `<section class="section">
            <h2>Stay</h2>
            <div class="card">
              <div class="k">${escapeHtml(hotel.name)}</div>
              <div class="v">
                ${hotel.rating ? `${hotel.rating}★` : ""}
                ${hotel.guestRating ? ` · ${escapeHtml(String(hotel.guestRating))}/5` : ""}
                ${hotel.distanceFromCenter ? ` · ${escapeHtml(String(hotel.distanceFromCenter))}` : ""}
              </div>
              ${hotel.pricePerNight ? `<div class="v">${inr(hotel.pricePerNight)}/night</div>` : ""}
            </div>
          </section>`
        : ""
    }

    ${
      pkg.totalPrice
        ? `<section class="section">
            <h2>Budget</h2>
            <div class="card">
              <div class="k">Package: ${inr(pkg.totalPrice)}</div>
              ${b.budget ? `<div class="v">Your budget: ${inr(b.budget)}</div>` : ""}
              ${b.budget && pkg.totalPrice > b.budget ? `<div class="v warn">⚠️ Over budget by ${inr(pkg.totalPrice - b.budget)}</div>` : ""}
            </div>
          </section>`
        : ""
    }

    ${daysHtml ? `<section class="section"><h2>Day-by-day</h2>${daysHtml}</section>` : ""}

    ${packing ? `<section class="section"><h2>Packing</h2><ul>${packing}</ul></section>` : ""}
    ${documents ? `<section class="section"><h2>Documents</h2><ul>${documents}</ul></section>` : ""}

    <div class="actions">
      <a class="btn" href="${escapeHtml(pdfUrl)}">Download PDF</a>
      <a class="btn secondary" href="https://wa.me/?text=${encodeURIComponent(dest + " trip plan: " + pdfUrl)}">Share</a>
    </div>

    <footer>Prepared by Travel Assistant · AI planning, real prices</footer>
  </div>
</body>
</html>`;
}