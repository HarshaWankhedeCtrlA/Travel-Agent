// Real weather via Open-Meteo — free, no API key.
// Uses forecast for near dates, historical archive for far dates.

const DAY = 86400000;

export async function getWeather({ city, departDate, returnDate }) {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&format=json`
    );
    const geo = await geoRes.json();
    const place = pickPlace(geo.results);
    if (!place) return null;

    const { latitude, longitude, name, country } = place;

    const now = new Date();
    const daysUntilTrip = Math.floor((new Date(departDate) - now) / DAY);
    const daysUntilReturn = Math.floor((new Date(returnDate || departDate) - now) / DAY);

    // The forecast reaches about 16 days ahead, and the whole trip must fit inside it
    if (daysUntilTrip >= 0 && daysUntilReturn <= 15) {
      return await getForecast({ latitude, longitude, name, country, departDate, returnDate });
    }
    return await getArchiveWeather({ latitude, longitude, name, country, departDate, returnDate });
  } catch (err) {
    console.error("[weather] failed:", err.message);
    return null;
  }
}

// A search for "Goa" returns several places with that name. The biggest one is
// almost always the one the traveler means (the Indian state, not a small town
// on another continent).
function pickPlace(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  return [...results].sort((a, b) => (b.population || 0) - (a.population || 0))[0];
}

async function getForecast({ latitude, longitude, name, country, departDate, returnDate }) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode");
  url.searchParams.set("timezone", "Asia/Kolkata");
  url.searchParams.set("start_date", departDate);
  url.searchParams.set("end_date", returnDate || departDate);

  const res = await fetch(url);
  const data = await res.json();
  if (!data.daily?.time?.length) return null;

  const maxArr = data.daily.temperature_2m_max.filter(Number.isFinite);
  const minArr = data.daily.temperature_2m_min.filter(Number.isFinite);
  const rainArr = (data.daily.precipitation_sum || []).filter(Number.isFinite);
  if (!maxArr.length || !minArr.length) return null;

  return {
    location: `${name}, ${country}`,
    minTemp: Math.round(minArr.reduce((a, b) => a + b, 0) / minArr.length),
    maxTemp: Math.round(maxArr.reduce((a, b) => a + b, 0) / maxArr.length),
    // Total rain over the whole trip
    rainMm: rainArr.length ? Math.round(rainArr.reduce((a, b) => a + b, 0) * 10) / 10 : 0,
    summary: describeWeather(mostCommon(data.daily.weathercode)),
    source: "open-meteo forecast",
    type: "forecast",
  };
}

async function getArchiveWeather({ latitude, longitude, name, country, departDate, returnDate }) {
  const tripDate = new Date(departDate);
  const lastYear = new Date().getFullYear() - 1;
  const month = String(tripDate.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(lastYear, tripDate.getMonth() + 1, 0).getDate();

  const startDate = `${lastYear}-${month}-01`;
  const endDate = `${lastYear}-${month}-${String(lastDay).padStart(2, "0")}`;

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum");
  url.searchParams.set("timezone", "Asia/Kolkata");

  const res = await fetch(url);
  const data = await res.json();

  if (!data.daily?.time?.length) return null;

  const maxArr = data.daily.temperature_2m_max.filter(Number.isFinite);
  const minArr = data.daily.temperature_2m_min.filter(Number.isFinite);
  const rainArr = (data.daily.precipitation_sum || []).filter(Number.isFinite);

  if (!maxArr.length || !minArr.length) return null;

  // Last year's month gives a typical rain per day. Scale it to the trip length
  // so this number means the same thing as the forecast's trip total.
  const tripDays = Math.max(1, Math.round((new Date(returnDate || departDate) - tripDate) / DAY) + 1);
  const avgDaily = rainArr.length ? rainArr.reduce((a, b) => a + b, 0) / rainArr.length : 0;

  return {
    location: `${name}, ${country}`,
    minTemp: Math.round(minArr.reduce((a, b) => a + b, 0) / minArr.length),
    maxTemp: Math.round(maxArr.reduce((a, b) => a + b, 0) / maxArr.length),
    rainMm: Math.round(avgDaily * tripDays * 10) / 10,
    summary: `Typical for ${tripDate.toLocaleString("en-IN", { month: "long" })} (last year's weather)`,
    source: "open-meteo archive",
    type: "climate",
  };
}

function mostCommon(codes) {
  const counts = new Map();
  for (const c of codes || []) if (Number.isFinite(c)) counts.set(c, (counts.get(c) || 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [code, n] of counts) {
    if (n > bestCount) {
      best = code;
      bestCount = n;
    }
  }
  return best;
}

function describeWeather(code) {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 67) return "Rainy";
  if (code <= 77) return "Snowy";
  if (code <= 82) return "Showers";
  if (code <= 99) return "Thunderstorms";
  return "Mixed weather";
}