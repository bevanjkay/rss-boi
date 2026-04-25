import process from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../../../prisma/generated/client/index.js";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString)
  throw new Error("DATABASE_URL is required");

const adapter = new PrismaPg(new Pool({ connectionString }));

export const prisma = new PrismaClient({ adapter });
