import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";

const UP_MARKER = "-- UP";
const DOWN_MARKER = "-- DOWN";

/**
 * Runs SQL-file migrations with Kysely's Migrator. The SQL files are the
 * migration source of truth (Decision e1-s0); each file carries `-- UP` and
 * `-- DOWN` sections that this provider splits into Kysely migrations.
 */
export class SqlFileMigrationProvider implements MigrationProvider {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".sql")).sort();
    const migrations: Record<string, Migration> = {};
    for (const file of files) {
      const name = file.replace(/\.sql$/, "");
      const text = await readFile(join(this.dir, file), "utf8");
      const upIndex = text.indexOf(UP_MARKER);
      const downIndex = text.indexOf(DOWN_MARKER);
      if (upIndex === -1 || downIndex === -1) {
        throw new Error(`migration ${file}: expected "-- UP" and "-- DOWN" section markers`);
      }
      const upSql = text.slice(upIndex + UP_MARKER.length, downIndex).trim();
      const downSql = text.slice(downIndex + DOWN_MARKER.length).trim();
      migrations[name] = {
        up: async (db) => {
          await sql.raw(upSql).execute(db);
        },
        down: async (db) => {
          await sql.raw(downSql).execute(db);
        },
      };
    }
    return migrations;
  }
}
