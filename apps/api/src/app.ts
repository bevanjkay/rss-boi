import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { ZodError } from "zod";
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

  app.setErrorHandler((error, request, reply) => {
    const candidate = error as { message?: unknown; name?: unknown; statusCode?: unknown };
    const isValidationError = error instanceof ZodError
      || (typeof candidate.name === "string" && candidate.name.includes("ZodError"));

    if (isValidationError) {
      return reply.code(400).send({
        message: "Validation failed.",
        issues: (error as ZodError).issues.map(issue => ({
          message: issue.message,
          path: issue.path.join("."),
        })),
      });
    }

    const statusCode = typeof candidate.statusCode === "number" ? candidate.statusCode : 500;

    if (statusCode >= 500) {
      request.log.error(error);
      return reply.code(500).send({ message: "Internal server error." });
    }

    return reply.code(statusCode).send({
      message: typeof candidate.message === "string" ? candidate.message : "Request failed.",
    });
  });

  await app.register(sensible);
  await app.register(rateLimit, {
    global: true,
    max: 1000,
    timeWindow: "1 minute",
  });
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
