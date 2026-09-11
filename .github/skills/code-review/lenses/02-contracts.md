# Lens: contracts and structure

Read `reviewer-contract.md` and these rules: `rules/repository-conventions.md`.

Your angle is the shape of the change: where code lives, how it is wired, what it exposes, and what
it returns. You are not looking for defects and you do not comment on formatting.

## Activate when

The diff adds, moves, renames, or deletes a module, route, schema, repository method, migration, or
exported type. Also when it changes a request or response body, a status code, or a public function
signature.

## What to check

1. **Placement.** Code sits at the smallest scope that needs it. A schema used by one route lives
   with that route; a schema shared by the whole application lives at the application root; domain
   logic lives in the package that owns the domain. A helper inlined at one call site does not
   belong in a shared module.
2. **Dependency direction.** Dependencies run one way. A package never imports from an application,
   a library package never imports a sibling that would close a cycle, and a persistence package
   never learns about the domain rules of what it stores.
3. **Wiring.** Handlers receive their dependencies rather than reaching for a module-level
   singleton. Construction happens once, at process start. There are no setters that exist only so a
   test can substitute a collaborator.
4. **Contract shape.** A response carries what the caller cannot already know: a value the caller
   supplied in the path or body is not echoed back. Distinct outcomes get distinct status codes.
   Inputs travel in the body, not in headers, unless the input describes the request itself.
5. **Return types.** An operation's return type states exactly what it can return, including the
   failure outcomes. A handler that can answer four ways does not declare that it answers one.
6. **Validation placement.** Input is validated at the boundary, by the schema that describes it.
   A handler does not re-check what the schema already proved, and a repository does not defend
   against inputs its callers cannot produce.
7. **Single path.** Behavior that must agree because it is the same behavior is implemented once.
   Validation, canonicalization, and identity assignment that must match across create, save, and
   publish are shared, not re-derived per entry point.
8. **Identity.** The server mints identifiers. Code does not restate the identifier scheme, its
   version, or its generating library; that belongs in the documents that define it.
9. **Migrations.** A migration is a typed module with a working `down`, additive changes only, no
   non-nullable column without a backfill, and field-level comments that explain the business
   reason for each column it adds or changes.
10. **Cutover.** A rename is complete. Aliases, deprecated paths, re-exports kept for compatibility,
    and dead files removed by the change are gone rather than left beside the new code.

Report `REPO-*` rule ids. When the change introduces a new convention rather than violating an
existing one, that is not a finding unless the convention in the rules is explicit.
