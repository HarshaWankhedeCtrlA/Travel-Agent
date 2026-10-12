// Real weather via Open-Meteo — free, no API key.
// Uses forecast for near dates, historical archive for far dates.

export async function getWeather({ city, departDate, returnDate }) {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );
    const geo = await geoRes.json();
    if (!geo.results?.length) return null;

    const { latitude, longitude, name, country } = geo.results[0];

    const daysUntilTrip = Math.floor((new Date(departDate) - new Date()) / 86400000);

    if (daysUntilTrip >= 0 && daysUntilTrip <= 14) {
      return await getForecast({ latitude, longitude, name, country, departDate, returnDate });
    }
    return await getArchiveWeather({ latitude, longitude, name, country, departDate });
  } catch (err) {
    console.error("[weather] failed:", err.message);
    return null;
  }
}

async function getForecast({ latitude, longitude, name, country, departDate, returnDate }) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode");
  url.searchParams.set("timezone", "Asia/Kolkata");
  url.searchParams.set("start_date", departDate);
  url.searchParams.set("end_date", returnDate);

  const res = await fetch(url);
  const data = await res.json();
  if (!data.daily?.time?.length) return null;

  const maxArr = data.daily.temperature_2m_max.filter(Number.isFinite);
  const minArr = data.daily.temperature_2m_min.filter(Number.isFinite);
  const rainArr = (data.daily.precipitation_sum || []).filter(Number.isFinite);

  return {
    location: `${name}, ${country}`,
    minTemp: Math.round(minArr.reduce((a, b) => a + b, 0) / minArr.length),
    maxTemp: Math.round(maxArr.reduce((a, b) => a + b, 0) / maxArr.length),
    rainMm: rainArr.length
      ? Math.round(rainArr.reduce((a, b) => a + b, 0) * 10) / 10
      : 0,
    summary: describeWeather(data.daily.weathercode?.[0] || 0),
    source: "open-meteo forecast",
    type: "forecast",
  };
}

async function getArchiveWeather({ latitude, longitude, name, country, departDate }) {
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

  return {
    location: `${name}, ${country}`,
    minTemp: Math.round(minArr.reduce((a, b) => a + b, 0) / minArr.length),
    maxTemp: Math.round(maxArr.reduce((a, b) => a + b, 0) / maxArr.length),
    rainMm: rainArr.length
      ? Math.round((rainArr.reduce((a, b) => a + b, 0) / rainArr.length) * 10) / 10
      : 0,
    summary: `Typical for ${tripDate.toLocaleString("en-IN", { month: "long" })} (last year's weather)`,
    source: "open-meteo archive",
    type: "climate",
  };
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