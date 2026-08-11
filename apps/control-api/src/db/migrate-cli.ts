import { loadConfig } from "../config";
import { createDb } from "./client";
import { migrateToLatest } from "./migrate";

const config = loadConfig();
const db = createDb(config.databaseUrl);
try {
  const results = await migrateToLatest(db);
  for (const result of results) {
    console.log(`${result.status}: ${result.migrationName}`);
  }
} finally {
  await db.end();
}
