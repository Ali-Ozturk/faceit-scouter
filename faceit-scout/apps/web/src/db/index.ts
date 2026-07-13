import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://faceit_scout:faceit_scout@localhost:5432/faceit_scout";

const client = postgres(databaseUrl, { prepare: false });

export const db = drizzle(client, { schema });
