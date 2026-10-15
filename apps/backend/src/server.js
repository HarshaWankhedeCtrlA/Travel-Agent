import "dotenv/config";
import app from "./app.js";
import { connectDatabase } from "./config/database.js";
import { startScheduler } from "./jobs/scheduler.js";
import { startReminderScheduler } from "./services/reminderScheduler.js";

const port = Number(process.env.PORT) || 3000;

try {
  await connectDatabase(process.env.MONGODB_URI);
  startScheduler();
  startReminderScheduler();   
  app.listen(port, () => {
    console.log(`Travel Agent API listening on port ${port}`);
  });
} catch (error) {
  console.error("Failed to start Travel Agent API:", error);
  process.exitCode = 1;
}
