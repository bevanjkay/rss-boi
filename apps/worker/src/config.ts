import process from "node:process";
import { z } from "zod";
import { createNetworkPolicy } from "./poller/ssrf.js";

const envSchema = z.object({
  ALLOW_PRIVATE_HOSTS: z.string().default(""),
  ALLOW_PRIVATE_NETWORK: z
    .enum(["true", "false"])
    .default("false")
    .transform(value => value === "true"),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = envSchema.parse(process.env);

// Built at startup so a malformed ALLOW_PRIVATE_HOSTS entry fails fast rather
// than surfacing as a per-feed fetch error later.
export const networkPolicy = createNetworkPolicy({
  allowPrivate: env.ALLOW_PRIVATE_NETWORK,
  allowedHosts: env.ALLOW_PRIVATE_HOSTS,
});
