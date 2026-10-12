import "dotenv/config";
import { getWeather } from "./src/providers/weather.js";

const result = await getWeather({
  city: "Pune",
  departDate: "2027-02-15",
  returnDate: "2027-02-18",
});

console.log(JSON.stringify(result, null, 2));