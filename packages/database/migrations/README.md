# Database migrations

This directory holds the database package's schema migrations. Each file
is one TypeScript module named `NNN_description.ts` that exports an `up`
function, which applies the change, and a `down` function, which reverts
it. Files run in filename order, so the numeric prefix defines the
sequence. Migration bodies import the table types from
[`src/schema/database.ts`](../src/schema/database.ts), so queries are
checked against the declared table shapes at build time.

## Contributing a migration

1. Take the next number and describe the change in the file name.
2. Implement `up` to apply the change and `down` to revert it. A missing
   or broken `down` fails the test suite.
3. Keep the change additive: create tables, indexes, and columns; never
   delete or repurpose existing data.
4. Never add a column declared `NOT NULL` without either a default that
   backfills existing rows or a companion migration that fills the values
   first. If neither works, start nullable and tighten later.
5. Never edit a migration after it merges. Corrections land as new
   migrations; retire tables or columns in their own later migration
   once no running version reads them.

To apply migrations against the target named by `DATABASE_URL`:

```bash
bun run db:migrate
```

Reruns are safe: applied migrations are recorded in the database and
skipped. Deploy tooling applies migrations once per rollout before new
application instances start; instances do not migrate at boot.

## Testing migrations

The round-trip suite in [`src/migrator.test.ts`](../src/migrator.test.ts)
applies every migration forward, reruns to a no-op, rolls back with
`migrateTo(NO_MIGRATIONS)`, asserts the tables are gone, and re-applies.
A new migration must keep that test green.

Run the database package's tests:

```bash
bun test packages/database
```

The tests use `DATABASE_URL` when it is set, as CI does, and otherwise
start an embedded Postgres cluster on a free local port, so no Docker
daemon is required.
