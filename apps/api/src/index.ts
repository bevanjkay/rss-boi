import process from "node:process";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/client.js";
import { pruneExpiredSessions } from "./lib/session.js";

const SESSION_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

async function main() {
  const app = await buildApp();

  const pruneTimer = setInterval(() => {
    pruneExpiredSessions().catch(error => app.log.error(error, "Failed to prune expired sessions"));
  }, SESSION_PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown)
      return;

    shuttingDown = true;
    app.log.info({ signal }, "Shutting down");
    clearInterval(pruneTimer);

    try {
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    }
    catch (error) {
      app.log.error(error, "Error during shutdown");
      process.exit(1);
    }
  };

  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => void shutdown(signal));

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.API_PORT,
    });
    void pruneExpiredSessions().catch(error => app.log.error(error, "Failed to prune expired sessions"));
  }
  catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
