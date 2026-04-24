import process from "node:process";
import { z } from "zod";

const envSchema = z.object({
  API_PORT: z.coerce.number().int().default(3001),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SESSION_SECRET: z.string().min(16),
});

export const env = envSchema.parse(process.env);
