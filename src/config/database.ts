import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "./env.js";

const schema = new URL(env.DATABASE_URL).searchParams.get("schema") ?? "public";
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error("Invalid database schema");
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL, options: `-c search_path="${schema}"`,
  max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000,
}, { schema });

export const prisma = new PrismaClient({ adapter });
