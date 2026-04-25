import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "classic",
  datasource: {
    url: process.env.DATABASE_URL
      ?? "postgresql://rssboi:changeme@localhost:5432/rssboi?schema=public",
  },
});