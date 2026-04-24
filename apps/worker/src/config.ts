import process from "node:process";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = envSchema.parse(process.env);
