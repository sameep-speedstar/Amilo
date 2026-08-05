import { config as loadEnv } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolve } from "node:path";

// Do not override an already-exported DATABASE_URL (Azure deploy).
if (!process.env.DATABASE_URL) {
  loadEnv({ path: resolve(process.cwd(), "../../.env") });
  loadEnv();
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

console.log("migrating", url.replace(/:[^:@/]+@/, ":***@"));

const client = url.includes("sslmode=require")
  ? postgres(url, { max: 1, ssl: "require" })
  : postgres(url, { max: 1 });
const db = drizzle(client);
const folder = resolve(import.meta.dirname, "../drizzle");

await migrate(db, { migrationsFolder: folder });
console.log("migrations applied from", folder);
await client.end();
