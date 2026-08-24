# Workflow database migrations

The migration files in this directory create and upgrade the workflow
tables (`workflows`, `revisions`, `published_versions`). Each file is one
TypeScript module named `NNN_description.ts` that exports an `up` function,
which applies the change, and a `down` function, which reverts it. Files run
in filename order. The types come from
[`src/schema/database.ts`](../src/schema/database.ts), so a migration that
reads or writes rows is checked against the declared table shapes at build
time.

Apply migrations against the target named by `DATABASE_URL`:

```bash
bun run db:migrate
```

Reruns are safe: applied migrations are recorded in the database and
skipped. Deploy tooling applies migrations once per rollout before new
application instances start; instances do not migrate at boot.

## Non-breaking upgrade rules

Every merged migration must be provably safe to run in production while the
previous application version is still serving traffic. A new migration:

1. Is additive only. It can create tables, indexes, and columns; it cannot
   delete or repurpose existing data.
2. Never adds a column declared `NOT NULL` without either a default that
   backfills existing rows or a companion migration that fills the values
   first. If neither is possible, the column starts nullable and a later
   migration tightens it after the backfill completes everywhere.
3. Ships a working `down`. The rollback test in
   [`src/repositories/workflow-repository.test.ts`](../src/repositories/workflow-repository.test.ts)
   rolls every migration back and forward again, so a missing or broken
   `down` fails the suite.
4. Is never edited after merge. Corrections land as new migrations.

To retire a column or table, ship the removal in its own later migration
after no running version reads it, and keep the `down` that recreates it.
