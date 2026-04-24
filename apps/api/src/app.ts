import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { attachUserFromSession } from "./lib/session.js";
import { authModule } from "./modules/auth/index.js";
import { bootstrapModule } from "./modules/bootstrap/index.js";
import { entriesModule } from "./modules/entries/index.js";
import { healthModule } from "./modules/health/index.js";
import { settingsModule } from "./modules/settings/index.js";
import { subscriptionsModule } from "./modules/subscriptions/index.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.decorateRequest("user", null);

  await app.register(sensible);
  await app.register(cookie, {
    secret: env.SESSION_SECRET,
  });
  await app.register(cors, {
    allowedHeaders: ["Content-Type"],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    origin: env.NODE_ENV === "development" ? true : env.APP_BASE_URL,
  });

  app.addHook("preHandler", attachUserFromSession);

  await app.register(healthModule);
  await app.register(async (api) => {
    await api.register(bootstrapModule, { prefix: "/api" });
    await api.register(authModule, { prefix: "/api" });
    await api.register(subscriptionsModule, { prefix: "/api" });
    await api.register(entriesModule, { prefix: "/api" });
    await api.register(settingsModule, { prefix: "/api" });
  });

  return app;
}
