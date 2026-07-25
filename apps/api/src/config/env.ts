import process from "node:process";
import { z } from "zod";
import { createNetworkPolicy } from "../lib/ssrf.js";

const envSchema = z.object({
  ALLOW_PRIVATE_HOSTS: z.string().default(""),
  ALLOW_PRIVATE_NETWORK: z
    .enum(["true", "false"])
    .default("false")
    .transform(value => value === "true"),
  API_PORT: z.coerce.number().int().default(3001),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SESSION_SECRET: z.string().min(16),
});

export const env = envSchema.parse(process.env);

// Built at startup so a malformed ALLOW_PRIVATE_HOSTS entry fails fast rather
// than surfacing as a per-download fetch error later.
export const networkPolicy = createNetworkPolicy({
  allowPrivate: env.ALLOW_PRIVATE_NETWORK,
  allowedHosts: env.ALLOW_PRIVATE_HOSTS,
});
