import { buildApp } from "./app.js";
import { assertProductionConfiguration } from "./runtime.js";

assertProductionConfiguration(process.env);
const app = await buildApp();
const port = Number(process.env.API_PORT ?? 4000);

let closing = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "graceful shutdown started");
  const forced = setTimeout(() => {
    app.log.error("graceful shutdown timed out");
    process.exit(1);
  }, 30_000);
  forced.unref();
  try {
    await app.close();
    clearTimeout(forced);
    process.exitCode = 0;
  } catch (error) {
    clearTimeout(forced);
    app.log.error(error);
    process.exitCode = 1;
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
