import "dotenv/config";
import app from "./app.js";
import { connectDatabase } from "./config/database.js";

const port = Number(process.env.PORT) || 3000;

try {
  await connectDatabase(process.env.MONGODB_URI);
  app.listen(port, () => {
    console.log(`Travel Agent API listening on port ${port}`);
  });
} catch (error) {
  console.error("Failed to start Travel Agent API:", error);
  process.exitCode = 1;
}
