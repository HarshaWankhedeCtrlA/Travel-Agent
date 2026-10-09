import "dotenv/config";
import { extractBrief } from "./src/llm/gateway.js";

console.log("Test 1: Full trip");
console.log(await extractBrief("Goa in December, 30k, 2 people"));

console.log("\nTest 2: Vague");
console.log(await extractBrief("somewhere warm next month with 2 friends, budget 50k"));

console.log("\nTest 3: Hinglish");
console.log(await extractBrief("Mujhe Goa jaana hai December mein, 3 log, 25k budget"));