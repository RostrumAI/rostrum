import { join } from "node:path";
import type { MigrationResult } from "kysely/migration";
import { Migrator } from "kysely/migration";
import { createKysely, type Sql } from "./client";
import { SqlFileMigrationProvider } from "./migrations-provider";

export const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

export function createMigrator(db: Sql): Migrator {
  return new Migrator({
    db: createKysely(db),
    provider: new SqlFileMigrationProvider(MIGRATIONS_DIR),
  });
}

export async function migrateToLatest(db: Sql): Promise<MigrationResult[]> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) throw error;
  return results ?? [];
}

export async function migrateDown(db: Sql): Promise<MigrationResult[]> {
  const { error, results } = await createMigrator(db).migrateDown();
  if (error) throw error;
  return results ?? [];
}
