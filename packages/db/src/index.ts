import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(databaseUrl: string) {
  const client = databaseUrl.includes("sslmode=require")
    ? postgres(databaseUrl, { max: 10, prepare: false, ssl: "require" })
    : postgres(databaseUrl, { max: 10, prepare: false });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
export * from "./schema.js";
export * from "./repos.js";
export * from "./travelRepos.js";
export * from "./watchRepos.js";
