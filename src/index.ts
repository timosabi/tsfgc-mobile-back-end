import "dotenv/config";
if (process.env.CRON_ENABLED === "true") {
  await import("./cron/sportmonks.cron.js");
}

import { app } from "./app.js";

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

server.keepAliveTimeout = 61_000;
server.headersTimeout = 65_000;
