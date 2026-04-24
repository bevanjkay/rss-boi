import process from "node:process";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

async function main() {
  const app = await buildApp();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.API_PORT,
    });
  }
  catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
