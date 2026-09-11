---
name: repository-conventions
description: Rostrum conventions mined from the repository's own review history. Use when reviewing a pull request for module placement, feature-slice and dependency-injection wiring, schema and validation placement, HTTP contracts, naming, comments and TSDoc, tests and fixtures, database migrations, library reuse, and dead-code removal. Every rule carries an id, the paths it applies to, a mechanical/judgment classification, a severity, the pattern to flag, and the review comment that motivated it.
---

# Repository conventions

These rules come from review comments on Rostrum pull requests #2 through #15. They describe where
code lives, how it is wired, what it exposes, and what proves it, not how it is formatted. Rules about
the Google TypeScript style guide, Biome, and lint live in `google-typescript.md`; do not restate them
here. The `REPO-TS-*` entries in section 8 are the repository's own syntax checks, which the
deterministic pass already reports; where a subject is also covered by a `GTS-*` rule, prefer the
`GTS-*` id. Never report anything Biome or `tsc` already rejects.

Scope: rules apply to the paths named in each entry, relative to the repository root. `apis/**` is the
planned home for backend services (E2.1 moves the Control API there); `apps/**` is its current home.
Treat the two as one surface. A rule applies only where its scope says so: a comment raised once about
workflows is not a repo-wide law, and a rule whose scope does not cover the changed path is not a
finding.

Classification: `mechanical` means a deterministic pass can decide the rule from the diff alone
(syntax, file names, presence of an export or a test). `judgment` means a reviewer must read intent
and surrounding code. Every `mechanical` rule is also a candidate for `bun run review --dry-run-rules`; do not
re-report what that pass already found.

Severity: `blocking` is reserved for a real defect or a stated repository invariant (a missing
handler test, a migration with no working `down`, a `NOT NULL` column with no backfill, a wrong HTTP
verb or status code, a client-minted identifier). Architecture preferences, naming, comment quality,
and cleanup are `major` or `minor`.

## 1. Module structure and dependency direction

### REPO-ARCH-01 — Keep package dependencies one-way
A package must never import from an application, and library packages must not import each other in
a way that can close a cycle; dependencies run application → package.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** major
**Flag:** An import in `packages/**` from `apps/**` or `apis/**`, or a sibling-package import that creates a package cycle.
**Evidence:** PR #9 `packages/database/src/repositories/workflow-repository.ts:1` — "a setup like this makes it VERY easy to start creating circular dependencies"; resolution states the direction "control-api → @rostrum/storage … and control-api → @rostrum/workflow … so a cycle cannot form".

### REPO-ARCH-02 — Keep shared packages ignorant of the domain they serve
A persistence or transport package stores what it is given; it must not name or depend on the
application's domain types, and the application must declare its own table map.
**Applies to:** `packages/**` · **Check:** judgment · **Severity:** major
**Flag:** A generic package importing a domain package, or a schema/type parameter that names an application entity.
**Evidence:** PR #9 `packages/storage/src/database.ts:1` — "we're tying database items very tightly across packages (to workflow types)"; resolution: "the storage package shouldn't have any concern about what is being stored" and "must not depend on an application".

### REPO-ARCH-03 — Put code where it executes and owns its data
Migrations, schema definitions, repositories, and their runner scripts live in the package or
application that executes them, not split across a thin wrapper package and its caller.
**Applies to:** `apps/**`, `apis/**`, `packages/**`, `**/migrations/**` · **Check:** judgment · **Severity:** major
**Flag:** A migration or repository owned by one package but defined or invoked in another; a database package that only wraps a connection while the app owns the tables.
**Evidence:** PR #9 `packages/storage/src/database.ts:1` — "make this a proper database package rather than leaving it as a thin connection and migration wrapper"; PR #9 `apps/control-api/src/scripts/migrate.ts:1` — "This work should be moved into the database package"; PR #9 `apps/control-api/package.json:12` — "Migration script lives with database package".

### REPO-ARCH-04 — Delete modules and barrels that exist only to re-export
A module must own behavior or data; a file that only wraps another helper, or an `index` that
centralizes exports, needs a stated purpose or it should not exist.
**Applies to:** `packages/**`, `apps/**`, `apis/**` · **Check:** judgment · **Severity:** minor
**Flag:** A new module whose body is re-exports or a thin wrapper around an existing library helper with no added rule.
**Evidence:** PR #12 `packages/workflow/src/document/id-splice.ts:1` — "I'm not sure what this file is giving us besides wrapping the parser helper … and some type wrappings"; PR #9 `packages/database/src/schema/database.ts:1` — "Is this just to centralize the exports (and if so, why?)".

## 2. Feature slices, wiring, and dependency injection

### REPO-SLICE-01 — Export `route`, `schema`, and `handler` from every feature slice
Each slice under `features/` is a boot-time module exporting the route binding, its schemas, and its
handler; a slice that misses the contract fails startup, so the shape is an invariant.
**Applies to:** `apps/**/src/features/**`, `apis/**/src/features/**` · **Check:** mechanical · **Severity:** blocking
**Flag:** A file under `features/` that does not export `route`, `schema`, and `handler`, or a slice whose folder path and route path disagree.
**Evidence:** PR #5 `apps/control-api/src/features/system/get-health.handler.ts:1` — "you need to export: route (GET /health), schema (anything), handler"; "any misaligned file will throw an error and prevent booting".

### REPO-SLICE-02 — Inject services through a `createHandler(services)` factory built at boot
Dependencies are constructed once at process start and passed into handlers; a handler that reaches
for a module singleton cannot be tested in isolation and changes behavior with boot order.
**Applies to:** `apps/**/src/features/**`, `apis/**/src/features/**` · **Check:** mechanical · **Severity:** major
**Flag:** A handler importing a module-level service, or a handler signature that builds its own dependencies instead of receiving the services object.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/create.ts:68` reply — "factory form. `createHandler(services)` returns the handler, preserving the base `Handler` type and the loader module contract; a `Services` object builds once at app boot".

### REPO-SLICE-03 — No module-level singletons or `setX` test seams
Stateful services are classes or static members; a lazy process-wide build and a setter that exists
only so a test can swap a collaborator are both forbidden.
**Applies to:** `apps/**/src/**`, `apis/**/src/**`, `packages/**` · **Check:** mechanical · **Severity:** major
**Flag:** A module-scope mutable service instance, a lazy `getService()`, or an exported `setService()` used by tests.
**Evidence:** PR #12 `apps/control-api/src/workflows/service.ts:317` — "Any reason to implement this like this vs a static member of the WorkflowService class?"; reply — "The lazy `workflowService()` singleton and the `setWorkflowService` test seam go away; per-slice tests inject a stub".

### REPO-SLICE-04 — Prefer the object-oriented form for services and route modules
A class or static member that a call site names explicitly reads better than a free function or a
module-level closure; a route binding defined as a plain object/function pair is the exception.
**Applies to:** `apps/**/src/**`, `apis/**/src/**` · **Check:** judgment · **Severity:** minor
**Flag:** A service or route module written as module-level functions where the surrounding code uses classes.
**Evidence:** PR #5 `apps/control-api/src/routes/system.ts:9` — "Let's swap the pattern here to be more object oriented vs functional - just personal preference for code legibility"; PR #12 `apps/control-api/src/workflows/service.ts:317` — "vs a static member of the WorkflowService class".

## 3. Schema scoping and validation placement

### REPO-SCHEMA-01 — Scope schemas to the smallest consumer
A schema used by one route lives in a colocated `*.schema.ts` beside that route; a schema shared
across the whole app lives at the application root (`src/schemas.ts`); a domain-wide schema lives in
the domain area, not at the root.
**Applies to:** `apps/**/src/**`, `apis/**/src/**` · **Check:** mechanical · **Severity:** major
**Flag:** A route-specific schema declared at the app root or in another feature's module; no `create.schema.ts`/`save.schema.ts` beside the slice that uses it.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/create.ts:41` — "move schemas to the smallest scope possible … we could have a create.schema.ts file defined here … generic ErrorResponse … live at the top of src/ … a workflow document lives in a workflows-level schemas.ts".

### REPO-SCHEMA-02 — Scope helpers to the smallest consumer too
The same smallest-scope rule applies to helper functions: a helper used by one route stays with that
route rather than being promoted to a shared module "for later".
**Applies to:** `apps/**/src/**`, `apis/**/src/**`, `packages/**` · **Check:** judgment · **Severity:** minor
**Flag:** A one-call-site helper exported from a shared or top-level module.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/create.ts:69` — "Same comment as the schema, but for helper functions like this".

### REPO-SCHEMA-03 — Validate at the schema boundary, not inside handlers or repositories
Input is checked by the schema that describes it; a handler or repository must not re-check what the
schema already proved, and repositories must not defend against inputs their callers cannot produce.
**Applies to:** `apps/**/src/features/**`, `apis/**/src/features/**`, `packages/**/repositories/**` · **Check:** judgment · **Severity:** major
**Flag:** Manual shape checks, JSON.parse guards, or re-validation inside a handler body or repository method that the route schema already covers.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/retrieve-version.ts:63` — "these can be tested with a schema validator instead of within the handler"; PR #12 `apps/control-api/src/features/workflows/rewind.ts:73` — "JSON validation can also be handled in the schema validator"; PR #12 `packages/database/src/repositories/workflow-repository.ts:73` — "This check seems like it's redundant to have here, and could be validated via a schema validator (in the upstream caller)".

### REPO-SCHEMA-04 — A format check is not an existence check
Validating that an identifier has the right shape does not prove the row exists; an operation that
addresses an entity must verify existence and return not-found.
**Applies to:** `packages/**/repositories/**`, `apps/**/src/**`, `apis/**/src/**` · **Check:** judgment · **Severity:** major
**Flag:** A repository method that accepts an id after only a UUID/regex check and proceeds to write or return as if the entity exists.
**Evidence:** PR #9 `packages/database/src/repositories/workflow-repository.ts:65` — "Are we not validating the workflow ID actually exists? Seems we're just checking it if is a UUIDv7 before moving on".

### REPO-SCHEMA-05 — One shared validation path across entry points
When validate, save, and publish must agree because they are the same behavior, that validation is
implemented once and shared; do not re-derive it per route.
**Applies to:** `apps/**/src/features/**`, `apis/**/src/features/**`, `packages/**` · **Check:** judgment · **Severity:** major
**Flag:** Two routes each assembling their own validation of the same document/body instead of calling one shared validator or request-body helper.
**Evidence:** PR #12 `packages/database/src/repositories/workflow-repository.ts:73` — validation belongs "in the upstream caller"; PR #12 `apps/control-api/src/features/workflows/create.ts:41` reply — `FindingSchema` and the document/revision schemas move to one workflows area rather than per-route copies.

### REPO-SCHEMA-06 — Parse configuration through a schema with documented layering
Config is validated against a schema; sources override per variable (env over YAML over documented
defaults), and defaults are defined in the config loader exactly once.
**Applies to:** `apps/**/src/config*.ts`, `apis/**/src/config*.ts`, `scripts/**` · **Check:** judgment · **Severity:** major
**Flag:** `process.env.X ?? "literal"` defaults scattered across scripts or modules; config values read without a validating schema.
**Evidence:** PR #5 `apps/control-api/src/config.ts:1` — "fed through an actual validator (like Zod) … variables present in env override yml variables"; PR #9 `apps/control-api/src/scripts/migrate.ts:6` — "defaults … should be centralized in the config loader".

## 4. Types and return shapes

### REPO-TYPE-01 — Give each operation a strict, feature-local return type
A function's return type enumerates exactly what it can return, including failure outcomes; a
handler that can answer several ways must not declare that it answers one.
**Applies to:** `apps/**/src/features/**`, `apis/**/src/features/**`, `packages/**` · **Check:** judgment · **Severity:** major
**Flag:** `Promise<Response>`, a bag of optional fields, or a widened union where the outcome discriminant is lost.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/retrieve-version.ts:80` — "I want per-feature return types to be much stricter than they are currently".

### REPO-TYPE-02 — Justify every cast and delete unreachable defensive branches
A cast that silences a mismatch, an `any`, or a branch guarding a condition the engine or type system
already guarantees is a finding; narrowing belongs in a guard or decoder.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** judgment · **Severity:** major
**Flag:** `as` casts with no comment, a retry/branch that handles multiple rows from a primary-key lookup, or a UUID-collision branch.
**Evidence:** PR #7 `packages/workflow/src/validation/stages/conditional-stage.ts:108` — "I'm also noticing a lot of type casting, what's the reasoning for that?"; PR #12 `apps/control-api/src/features/workflows/create.ts:46` — on a UUID-collision branch, "This honestly isn't something we should even be considering as possible"; PR #9 `packages/database/src/repositories/workflow-repository.ts:118` — a `>1` result branch cannot occur on a primary-key read.

### REPO-TYPE-03 — A compile-time generic is not runtime validation
Type parameters only assert a result type at compile time; if the stored row must be narrowed, use a
schema or decoder that can actually fail.
**Applies to:** `packages/**/repositories/**`, `packages/**/schema/**`, `apps/**/src/**` · **Check:** judgment · **Severity:** major
**Flag:** A repository method generic like `get<UserType>()` whose body never checks the returned row against `UserType`.
**Evidence:** PR #9 `packages/database/src/repositories/workflow-repository.ts:1` reply — "A caller-selected generic such as getUser<UserType>() would only assert the result type at compile time; it would not prove that the row satisfies UserType."

## 5. Identity and HTTP contract

### REPO-CONTRACT-01 — Do not restate the identifier scheme in code
The identifier scheme, its version, and its generating library are defined by the decision documents;
source, comments, and schema descriptions refer to an id as an id.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** major
**Flag:** `UUIDv7`, a UUID library name, or the id version in a comment, TSDoc, identifier, or schema description (documents under `dev-docs/**` are the exception).
**Evidence:** PR #12 `apps/control-api/src/features/workflows/create.ts:23` — "No need to keep mentioning server-minted IDs everywhere"; `publish.ts:22` — "We also don't need to declare UUIDv7 everywhere. Remove all mentions of it across the codebase"; `retrieve-draft.ts:16` — "UUIDv7 unnecessary mention"; `retrieve-revision.ts:16` — "UUIDv7 mentions again".

### REPO-CONTRACT-02 — Mint identifiers on the server, never accept a client-minted id
The server is the only identity authority; a create input that accepts an id splits that authority and
lets a caller misaddress or collide with an entity.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** blocking
**Flag:** A create/insert input carrying an id supplied by the caller while the server mints ids elsewhere.
**Evidence:** PR #3 `docs/decisions/epic-01/e1-s3-draft-publication-lifecycle.md:135` — "IDs must be generated by the server"; PR #9 `packages/database/src/repositories/workflow-repository.ts:137` — "we mint IDs here for revisions, but rely on the caller to generate IDs for workflow drafts"; reply rejects author-supplied workflow ids.

### REPO-CONTRACT-03 — Use the HTTP verb that matches the operation
A full-document replacement is `PUT`; using `POST` for an idempotent addressable update is a contract
defect.
**Applies to:** `apps/**/src/features/**`, `apis/**/src/features/**` · **Check:** mechanical · **Severity:** blocking
**Flag:** `POST` on a route that replaces an existing resource at a stable path.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/save.ts:25` — "PUT not POST".

### REPO-CONTRACT-04 — Carry request parameters in the body, not in headers
Inputs that are part of the resource representation (revision name, document bytes) travel in the
request body; headers describe the request itself.
**Applies to:** `apps/**/src/features/**`, `apis/**/src/features/**` · **Check:** mechanical · **Severity:** major
**Flag:** `c.req.header(...)` read for a body-shaped value, or an OpenAPI `parameters` entry for a field the body should carry.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/save.ts:89` — "Nope - this is a body param not a header"; `save.ts:101` — "Revision name belongs in the body not as a header"; `create.ts:29` — "This should be in the POST request instead".

### REPO-CONTRACT-05 — Give distinct outcomes distinct status codes
A created publication answers `201`; a replayed, already-existing outcome answers `200`. Returning the
same status for both makes the outcome indistinguishable to a caller.
**Applies to:** `apps/**/src/features/**`, `apis/**/src/features/**` · **Check:** mechanical · **Severity:** blocking
**Flag:** Two different outcome discriminants mapping to the same status in the route response table.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/publish.ts:69` — "Should `already-published` share the same response code as `published`? I'm thinking a `201` is good for `published` and a `200` for `already-published`".

### REPO-CONTRACT-06 — Response shapes carry only what the caller cannot already know
Do not echo values the caller supplied in the path or body, and give every response member a
caller-facing job; an unexplained field is a finding.
**Applies to:** `apps/**/src/features/**`, `apis/**/src/features/**` · **Check:** judgment · **Severity:** major
**Flag:** A response member equal to a path parameter, or a member whose purpose no caller can state.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/publish.ts:35` — "I don't get the purpose of the response shape"; reply concedes `workflowId` "is the one echo — it is already in the path".

### REPO-CONTRACT-07 — Handle shared statuses once
Cross-cutting failures (`500`, and later `401`/`403`) are handled and documented at the app level;
per-route handlers document only the outcomes specific to them, so the error shape stays single.
**Applies to:** `apps/**/src/**`, `apis/**/src/**` · **Check:** judgment · **Severity:** minor
**Flag:** A route repeating the internal-error response, or each route documenting `500`/`403` separately while the app already maps them globally.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/retrieve-draft.ts:24` — "we don't want to consider 403/500 issues as part of this?"; reply — "unmapped failures reach the app onError path … the single error shape (`internal_error`), so it is documented once instead of repeated on every route".

## 6. Naming and terminology

### REPO-NAME-01 — Name a function so the call site reads correctly without opening it
A function name states what it does and on what; retrieval functions take a `get` prefix, and a
generic name on a narrowly scoped helper is a finding.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** major
**Flag:** A call like `getRevision(id)` ambiguous about its target; `publishedVersion` where `getPublishedVersion` is meant; a workflow-scoped helper named `notFound`.
**Evidence:** PR #12 `apps/control-api/src/workflows/service.ts:165` — "I should always be able to tell exactly what a function is doing by reading just its call … WorkflowService.getRevision would"; `retrieve-version.ts:63` — "Rename `publishedVersion` to `getPublishedVersion`"; `errors.ts:64` — "`notFound` is a really generic helper function name especially since its scoped specifically to workflows".

### REPO-NAME-02 — Use the terminology the current decisions define
Names and prose follow the governed terms; do not reintroduce a retired concept under a new name or
rename an established one without the decision record.
**Applies to:** `apps/**`, `apis/**`, `packages/**`, `dev-docs/**`, `**/*.md` · **Check:** judgment · **Severity:** major
**Flag:** A new name for a concept the current Epic/decision names differently, or prose that contradicts the schema beside it.
**Evidence:** PR #3 `docs/decisions/epic-01/e1-s3-draft-publication-lifecycle.md:15` — "the language … can be simplified … Confer with WRITING_STYLE.MD"; the methodology requires "terminology from the current governing decisions".

### REPO-NAME-03 — Do not hardcode product identity in source
The product name and version come from package metadata or configuration; a constant in a handler
that restates them goes stale.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** judgment · **Severity:** minor
**Flag:** A literal `"rostrum"` or a hardcoded version string in a handler or module.
**Evidence:** PR #5 `apps/control-api/src/features/system/get-version.handler.ts:6` — "we don't need to say we're rostrum. I'm thinking maybe this also comes from the package.json".

### REPO-WRITING-01 — Use standard terms and the rejected-word replacements
Use the repository's plain term for a concept: `database` not "store", "request body" not "envelope";
avoid jargon such as "backstop" in favor of words a reader can resolve.
**Applies to:** `apps/**`, `apis/**`, `packages/**`, `dev-docs/**`, `**/*.md` · **Check:** mechanical · **Severity:** minor
**Flag:** The words `store`/`storage` for the database layer, `envelope` for the request body, `backstop`, or other unexplained shorthand in code and prose.
**Evidence:** PR #9 `apps/control-api/src/workflows/store.ts:24` — "Let's swap 'store' language everywhere to 'database'"; PR #12 `apps/control-api/src/features/workflows/create.ts:54` — "Can we rename from 'envelope' to a more standard term?"; PR #9 `packages/database/migrations/002_revisions.ts:32` — "Let's not use language like 'backstop' vs more clear terms - refer to Google style dictionary".

## 7. Comments and TSDoc

### REPO-DOC-01 — Put TSDoc on every declaration, including private ones
Every exported declaration, class, non-obvious function, and private helper carries TSDoc; a short
one-line purpose is enough.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** major
**Flag:** A new function, class, or exported symbol with no TSDoc block.
**Evidence:** PR #9 `packages/database/src/repositories/workflow-repository.ts:1` — "Let's get TSDoc on all files here (including private)"; PR #7 `packages/workflow/src/parse/json-source-parser.ts:155` — "All functions should have TSDoc"; PR #5 `apps/control-api/src/features/system/get-health.handler.ts:5` — "TSDoc on all functions".

### REPO-DOC-02 — Comments state business purpose, not mechanics
A comment says why the code exists, what rule it satisfies, or what a caller does with it; a comment
that restates the signature or the next statement is a finding.
**Applies to:** `apps/**`, `apis/**`, `packages/**`, `**/*.md` · **Check:** judgment · **Severity:** major
**Flag:** TSDoc like "Gets the workflow"; a helper comment that paraphrases its own body; a route-metadata helper with no note that it feeds the OpenAPI document.
**Evidence:** PR #5 `apps/control-api/src/features/system/get-health.handler.ts:3` — "TSDoc on classes should state business purpose vs 'here's what this code obviously does' … this should be stating why we have a health endpoint"; PR #12 `apps/control-api/src/app.ts:121` — "leave a tiny note in the comment here (Used for building OpenAPI JSON output)".

### REPO-DOC-03 — Comment the parts a reader cannot decode
Opaque literals, protocol constants, magic numbers, and multi-step algorithms carry a short comment;
long functions get brief walkthrough comments that a junior engineer can follow.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** judgment · **Severity:** minor
**Flag:** A non-human-readable constant with no explanation; a long branch-heavy function with no step comments.
**Evidence:** PR #7 `packages/workflow/src/parse/json-source-parser.ts:281` — "When using things clearly not human-readable, we'd want to leave clear short comments explaining what this is"; `json-source-parser.ts:94` — "add some high-level, VERY SHORT, comments … dictating the logic behind some of the more obscure parts"; `conditional-stage.ts:37` — "walkthrough comments … clear to a junior engineer the steps going on here"; `references-stage.ts:144`, `termination-stage.ts:36`, `graph-stage.ts:18` — same request.

### REPO-DOC-04 — Do not cite files by path in TSDoc or comments
A comment describes the concept; a path reference goes stale when the file moves and gives the reader
no context.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** minor
**Flag:** A TSDoc or comment containing a repository-relative file path as its explanation.
**Evidence:** PR #12 `apps/control-api/src/workflows/rule-sets.ts:6` — "Direct file references in TSDoc".

### REPO-DOC-05 — Write prose for its reader
Documentation leads with what the reader must understand, uses the repository's writing rules, and
avoids filler or restating the editing process; match detail to the document's purpose.
**Applies to:** `dev-docs/**`, `**/*.md` · **Check:** judgment · **Severity:** minor
**Flag:** An overview that catalogs sample implementations; prose a junior engineer cannot follow; promotional or process narration.
**Evidence:** PR #3 `docs/decisions/epic-01/e1-s3-draft-publication-lifecycle.md:15` — "the language being used here can be simplified such that it can be easily understood by a junior software engineer without impacting the level of detail"; `AGENTS.md` "Writing style" is the governing rule.

## 8. Code readability and TypeScript hygiene

### REPO-TS-01 — No `any`; use a real type, a generic, or `unknown` plus narrowing
`any` erases the checking the rest of the repository relies on, and a value of unknown shape is
exactly what a schema or decoder is for.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** blocking
**Flag:** `: any`, `<any>`, or `as any` in a `.ts`/`.tsx` file.
**Evidence:** PR #7 `packages/workflow/src/validation/stages/conditional-stage.ts:108` — "I'm also noticing a lot of type casting, what's the reasoning for that?"; PR #9 `packages/database/src/repositories/workflow-repository.ts:1` reply — "If runtime narrowing is needed, the repository should use an actual schema or decoder."

### REPO-TS-02 — No single-line shorthand control flow
An `if` or loop body uses an explicit braced block; shorthand that compresses a statement onto one
line is unreadable and rejected outright.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** major
**Flag:** `if (x) return;` on one line, or any `if`/`else` without braces.
**Evidence:** PR #7 `packages/workflow/src/parse/json-source-parser.ts:137` — "Never shorthand if statements like this"; `conditional-stage.ts:40` — "Avoid shorthands like this where possible - readability is the highest priority."

### REPO-TS-03 — No direct console output outside the logging layer
Console calls bypass the configured logger, so records lose their level, fields, and destination;
only scripts, tests, and the logger module itself may write to the console.
**Applies to:** `apps/**`, `apis/**`, `packages/**` (excluding `scripts/`, `**/*.test.ts`, and the logger module) · **Check:** mechanical · **Severity:** major
**Flag:** `console.log`, `console.error`, `console.warn`, `console.info`, or `console.debug` in application source.
**Evidence:** PR #5 `apps/control-api/src/logger.ts:13` — "Rather than creating our own logger, let's use something more industry standard like LogTape"; PR #5 `apps/control-api/src/app.ts:64` — "Debug logging should log all incoming requests and all responses".

### REPO-TS-04 — No type-error suppression
`@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck` hide the next real error on the same line; fix the
type or narrow it explicitly instead.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** major
**Flag:** `@ts-ignore`, `@ts-expect-error`, or `@ts-nocheck` in any `.ts`/`.tsx` file.
**Evidence:** PR #7 `packages/workflow/src/validation/stages/conditional-stage.ts:108` — casts "silence" a mismatch the reviewer asked the author to explain; PR #9 `packages/database/src/repositories/workflow-repository.ts:1` reply — narrow with "an actual schema or decoder".

### REPO-TS-05 — Do not commit unfinished work markers
A `TODO`/`FIXME` in source defers work the change should finish or schedule in the task document;
foundation work especially is completed now, not left as a marker.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** minor
**Flag:** `TODO:`, `FIXME:`, `XXX:`, or `HACK:` in a source file.
**Evidence:** PR #2 `docs/decisions/epic-01/e1-s1-workflow-interface-v1.md:251` — "What made this future work … This should be done now before we build out any code - … a foundation is very difficult to change"; PR #12 `apps/control-api/src/workflows-lifecycle.test.ts:1` — deferred integration coverage was tracked as its own task and the file deleted.

### REPO-CODE-01 — Prefer `switch` to a long `if`/`else` chain
When several branches test the same subject, a `switch` states the mapping directly.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** judgment · **Severity:** major
**Flag:** Three or more `if`/`else if` branches discriminating on one value.
**Evidence:** PR #7 `packages/workflow/src/parse/json-source-parser.ts:140` — "Let's swap stuff like this to switch/case".

### REPO-CODE-02 — Build result objects stepwise instead of nesting spread shorthand
A reader must be able to follow how a returned object is assembled; nested spreads hide which key
wins.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** major
**Flag:** An object literal combining multiple `...` spreads whose resulting keys are not obvious.
**Evidence:** PR #12 `apps/control-api/src/app.ts:113` — "These shorthands are really unreadable - can we modify this function to slowly build up to the total result we need to return?"

## 9. Tests: coverage and quality

### REPO-TEST-01 — A suite runs every case; no focused or skipped tests
A focused (`.only`) or skipped (`.skip`) case silently disables the rest of the run, so a green suite
hides exactly the cases a reviewer asked to add.
**Applies to:** `**/*.test.ts` · **Check:** mechanical · **Severity:** blocking
**Flag:** `.only(` or `.skip(` on a test or describe block.
**Evidence:** PR #7 `packages/workflow/src/validation/stages/conditional-stage.test.ts:7` — "How do we handle scenarios such as empty groups? Are there any other test cases we could be missing?"; PR #12 `apps/control-api/src/workflows/documents.test.ts:7` — coverage is judged against the suite that actually runs.

### REPO-TEST-02 — Assert the behavior, not the stub you installed
A test that resolves a stub and then asserts the value it stubbed proves nothing; the assertion must
be able to fail when the implementation is wrong.
**Applies to:** `**/*.test.ts` · **Check:** judgment · **Severity:** major
**Flag:** A test that constructs a value, returns it from a mock, and asserts the response equals that value; an assertion that cannot distinguish the handler's mapping from the stub's output.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/publish.test.ts:30` — "I want to make sure it's not just stubbing the response and asserting on it"; reply — the test is valid only because it asserts the handler maps the outcome and builds the body itself.

### REPO-TEST-03 — Cover every new handler and behavior with a test
A new handler, repository method, route, validation stage, or public function arrives with a test that
exercises it; a new source file with no test beside it is blocking.
**Applies to:** `apps/**`, `apis/**`, `packages/**`, `**/*.test.ts` · **Check:** mechanical · **Severity:** blocking
**Flag:** A new `handler`, `service`, or route module in the diff with no corresponding test file; a handler with only a happy-path test when it has documented failure outcomes.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/create.ts:64` — "Why does this handler have no tests?"; the same question at `publish.ts:56`, `retrieve-draft.ts:40`, `retrieve-revision.ts:48`, `retrieve-version.ts:59`, `rewind.ts:65`, `save.ts:86`, `validate.ts:46`.

### REPO-TEST-04 — Assert what a delegating handler forwards
Where a handler calls a service, the test asserts the arguments and call counts it passed down, and
failure paths assert the service was never called.
**Applies to:** `**/*.test.ts` · **Check:** mechanical · **Severity:** major
**Flag:** A per-slice handler test whose service double is a plain function with no argument/call-count assertion.
**Evidence:** PR #12 `apps/control-api/src/features/workflows/publish.test.ts:30` reply — "every service stub in the per-slice suites is now a `mock()` asserting the forwarded arguments … and call counts, and each failure path asserts the service is never called".

### REPO-TEST-05 — Do not duplicate or retain a redundant suite
Before claiming coverage, find the existing suite; a test that restates a case another suite already
covers is deleted, and a suite made redundant by an integration/CI check is deleted rather than kept.
**Applies to:** `**/*.test.ts` · **Check:** judgment · **Severity:** major
**Flag:** New cases that restate an existing suite's cases; boot/health smoke suites that a CI start check already covers.
**Evidence:** PR #12 `apps/control-api/src/workflows/documents.test.ts:7` — "What tests are being accomplished here that aren't already covered by packages/workflow/src/parse/json-source-parser.test.ts?"; `app.test.ts:1` — "if we have a test (as a CLI command, not in code) that the webserver can start … this entire file becomes unneeded"; `loader.test.ts:1`, `server.test.ts:1`, `workflows-lifecycle.test.ts:1` — "Another useless test suite"; "create integration tests for the entire flow and delete this file".

### REPO-TEST-06 — Cover the boundaries and repeat-call behavior, not only the happy path
Edge cases the implementation accepts (empty collections, repeat invocations, malformed input,
conflicting states) each get a case; an idempotency or repeat-call question must be answered by a test.
**Applies to:** `**/*.test.ts` · **Check:** judgment · **Severity:** major
**Flag:** A new suite with no empty-input, error-outcome, or repeated-invocation case; a documented outcome with no test.
**Evidence:** PR #7 `packages/workflow/src/validation/stages/conditional-stage.test.ts:7` — "How do we handle scenarios such as empty groups? Are there any other test cases we could be missing?"; PR #12 `apps/control-api/src/features/workflows/create.test.ts:26` — "what happens if this endpoint is hit twice in a row (idempotency check)?"

### REPO-TEST-07 — Read document inputs from the shared fixtures
Tests use the repository's fixtures rather than writing documents inline, so the same input is
exercised everywhere and can be updated once.
**Applies to:** `**/*.test.ts`, `packages/**/fixtures/**` · **Check:** mechanical · **Severity:** major
**Flag:** A JSON workflow document literal embedded in a test file where a fixture exists or should.
**Evidence:** PR #9 `packages/database/src/repositories/workflow-repository.test.ts:64` — "We should be pulling workflow documents from the fixtures".

### REPO-TEST-08 — Use a real database; skip with a message, never fake it
Integration tests run against Postgres, using `DATABASE_URL` when present (as CI does) and skipping
with a message when it is unreachable; an in-memory substitute hides the behavior under test.
**Applies to:** `**/*.test.ts`, `packages/**/repositories/**` · **Check:** mechanical · **Severity:** major
**Flag:** An in-memory or mock Postgres used by a repository/migration test instead of the real connection.
**Evidence:** PR #9 `packages/database/src/repositories/workflow-repository.test.ts:27` — "Can we not use a in-memory Postgres database here (where if DATABASE_URL is passed we use that instead, like in CI environments)?"

### REPO-TEST-09 — A type-level assertion is not a test
A file whose only content asserts that a type compiles, or a test that only re-checks a schema's
shape, proves nothing about behavior and does not belong in the suite.
**Applies to:** `**/*.test.ts` · **Check:** mechanical · **Severity:** major
**Flag:** A test that asserts a type, a compile-time generic, or a schema property's literal shape and exercises no runtime path.
**Evidence:** PR #9 `packages/database/src/repositories/workflow-repository.ts:1` reply — a compile-time generic "would only assert the result type at compile time; it would not prove that the row satisfies UserType"; PR #9 `packages/database/src/schema/database.ts:1` — asks whether a file exists only to centralize types/exports.

### REPO-TEST-10 — Co-locate tests with the code they test
Tests live in `src/` beside their subject; do not create a parallel `tests/` tree or scatter test
files away from the module.
**Applies to:** `apps/**`, `apis/**`, `packages/**`, `**/*.test.ts` · **Check:** mechanical · **Severity:** minor
**Flag:** A test file outside `src/` beside its subject, or a test whose fixture path assumes a moved tree.
**Evidence:** PR #9 `packages/workflow/src/fixtures/expected/incomplete/conditional-invalid-operator.json:1` reply — "All the `.test.ts` files live in `src/` (no `tests/` dir exists)".

## 10. Fixtures

### REPO-FIXTURE-01 — Place fixtures where the package export map resolves them
Fixture files that other packages import live under the path the `exports` map points at; moving them
to `tests/` breaks package-name imports that already exist.
**Applies to:** `packages/**/fixtures/**`, `packages/**/package.json` · **Check:** mechanical · **Severity:** major
**Flag:** A fixture moved or added outside an exported subpath while consumers import it by package name.
**Evidence:** PR #9 `packages/workflow/src/fixtures/expected/incomplete/conditional-invalid-operator.json:1` — "Any reason fixtures should be in `src` instead of `tests`?"; reply — "The export map targets `src` … That only resolves if the files sit where the export subpath points".

### REPO-FIXTURE-02 — Do not widen the public surface for test-only data
Fixtures that no external package needs stay internal; if a fixture is test-only, keep it off the
package's published exports and import it by relative path.
**Applies to:** `packages/**` · **Check:** judgment · **Severity:** minor
**Flag:** An export subpath added only so a test can import a fixture; test-only data listed in `exports`.
**Evidence:** PR #9 `packages/workflow/src/fixtures/...json:1` reply — "this puts test-only fixture data into the package's *published* export surface. If we want fixtures internal, the cleaner fix is to drop the `./fixtures/*.json` export".

## 11. Database and migrations

### REPO-DB-01 — Migrations are typed modules, not SQL files
Each migration is a TypeScript module named `NNN_description.ts` exporting typed `up`/`down` against
the schema types, so queries are checked before they run.
**Applies to:** `**/migrations/**` · **Check:** mechanical · **Severity:** major
**Flag:** A new `*.sql` migration or an untyped `up`/`down`.
**Evidence:** PR #9 `packages/storage/migrations/001_workflows.sql:1` — "Aren't kysely migration files supposed to be typed code?"; `packages/storage/src/migrator.ts:22` — "Swap to TS migration files per comment on 001_workflows.sql".

### REPO-DB-02 — Every migration has a working `down`, proven by a round-trip test
A missing or broken `down` fails CI; the suite applies all migrations, rolls back, asserts the tables
are gone, and re-applies to a no-op.
**Applies to:** `**/migrations/**`, `**/*.test.ts` · **Check:** mechanical · **Severity:** blocking
**Flag:** A migration with no `down` export, a `down` that does not revert its `up`, or no test exercising the rollback.
**Evidence:** PR #9 `packages/database/migrations/README.md:1` — "I'm not seeing any test files for these migrations in this directory"; reply — "rolls every migration back with `migrateTo(NO_MIGRATIONS)` … so a missing or broken `down` fails CI".

### REPO-DB-03 — Migrations are additive and applied migrations are never edited
A migration creates tables, indexes, and columns; it never deletes or repurposes existing data, and
after merge it is immutable so every environment applies the same history.
**Applies to:** `**/migrations/**` · **Check:** mechanical · **Severity:** blocking
**Flag:** A `DROP`, destructive `ALTER`, or edit to an existing migration file in the diff.
**Evidence:** PR #9 `packages/storage/migrations/001_workflows.sql:1` — "all future upgrades must be non-breaking"; reply — "additive-only changes … and no post-merge edits to applied migrations".

### REPO-DB-04 — No `NOT NULL` column without a backfill
A new non-nullable column must have a default that backfills existing rows or a companion migration
that fills them first; otherwise it starts nullable and tightens later.
**Applies to:** `**/migrations/**` · **Check:** mechanical · **Severity:** blocking
**Flag:** `.addColumn(..., "col", "...", (c) => c.notNull())` with no default and no backfilling migration.
**Evidence:** PR #9 `packages/storage/migrations/001_workflows.sql:1` — "new fields cannot have 'NOT NULL' as an assertion unless a script runs to backfill all values … we need to be able to prove that a new column won't break production".

### REPO-DB-05 — Comment each field and raw statement with its business purpose
Migration files carry field-level comments explaining the business reason for each column added or
changed; raw SQL statements explain the problem they solve.
**Applies to:** `**/migrations/**` · **Check:** judgment · **Severity:** major
**Flag:** A new column or constraint with only a type and no purpose comment; a raw SQL block with no explanation.
**Evidence:** PR #9 `packages/database/migrations/001_workflows.ts:1` — "I'd add more field-level comments along these files explaining business purpose for changes"; `002_revisions.ts:1` — "For things requiring raw SQL statements, explain what purpose it solves"; three migrations carry the same comment.

### REPO-DB-06 — Mint identifiers inside the persistence boundary consistently
Where the repository is the server's write path, it mints entity ids itself; it must not accept a
caller id for one entity while minting another internally.
**Applies to:** `packages/**/repositories/**`, `**/migrations/**` · **Check:** judgment · **Severity:** major
**Flag:** A create input that accepts an id while a sibling save method mints its own.
**Evidence:** PR #9 `packages/database/src/repositories/workflow-repository.ts:137` — "It's weird that we mint IDs here for revisions, but rely on the caller to generate IDs for workflow drafts - should the behaviors not be consistent?"

### REPO-DB-07 — Soft-delete user-deletable entities by default
Entities a user can delete get a soft-delete path unless the contract explicitly defines destruction;
a hard delete is a decision to record, not a shortcut.
**Applies to:** `packages/**/repositories/**`, `**/migrations/**` · **Check:** judgment · **Severity:** major
**Flag:** A new hard `DELETE` on an entity a user can remove, with no recorded decision.
**Evidence:** PR #9 `packages/database/src/repositories/workflow-repository.ts:231` — "Should we be hard vs soft deleting revisions? I'm thinking we'll want to lean with soft deletes first across all models".

### REPO-DB-08 — Describe stored rows accurately; map to application types in the repository
The schema describes what can physically exist, even when looser than the application type; the
repository maps or decodes it, and it never becomes a module-level singleton.
**Applies to:** `packages/**/schema/**`, `packages/**/repositories/**` · **Check:** judgment · **Severity:** major
**Flag:** A schema type narrowed to the app's type instead of the row's; a module-scope database handle or per-call pool.
**Evidence:** PR #9 `packages/database/src/repositories/workflow-repository.ts:1` reply — "the database schema should describe the stored row accurately, even when it is looser than the application type"; `packages/storage/src/storage.ts:19` reply — "one postgres.js pool per process — there is no module-level singleton or shared state".

## 12. Library reuse, dependencies, and abstraction

### REPO-LIB-01 — Use a maintained library instead of hand-rolling infrastructure
Identifier generation, logging, canonicalization, migration running, and config validation use a
standard dependency rather than a bespoke implementation.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** mechanical · **Severity:** major
**Flag:** A hand-rolled UUID/ULID generator, a custom logger, a bespoke migration runner, or an ad-hoc config parser.
**Evidence:** PR #9 `packages/storage/src/uuid-v7.ts:23` — "I feel like a library definitely exists to handle this vs reimplementing"; PR #5 `apps/control-api/src/logger.ts:13` — "Rather than creating our own logger, let's use something more industry standard like LogTape"; PR #5 `apps/control-api/src/config.ts:1` — "fed through an actual validator (like Zod)".

### REPO-LIB-02 — Do not wrap a dependency helper without adding a rule
A module or function that only forwards to a library call, or re-types what the library already types
correctly, is dead weight and should be deleted.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** judgment · **Severity:** major
**Flag:** A one-line passthrough with no validation, error mapping, or domain rule of its own.
**Evidence:** PR #7 `packages/workflow/src/parse/json-source-parser.ts:45` — "What's the point of this existing vs creating a JsonParse directly?"; PR #12 `packages/workflow/src/document/id-splice.ts:1` — "wrapping the parser helper which is another wrapper around momoa".

### REPO-LIB-03 — No generic CRUD layer over the ORM
The query builder already provides typed operations; add explicit repository methods for entity rules
and share small helpers only once concrete duplication exists.
**Applies to:** `packages/**/repositories/**` · **Check:** judgment · **Severity:** major
**Flag:** A generic `CrudRepository<T>`/`BaseRepository` whose entity-specific behavior leaks back in as hooks.
**Evidence:** PR #9 `packages/storage/src/database.ts:1` reply — "I do not think we need a generic CRUD abstraction on top of Kysely … Those rules belong in explicit repository methods".

### REPO-DEPS-01 — A dependency change states the code that consumes it
A manifest edit that arrives without accompanying source needs a stated reason in the pull request; a
new dependency must be needed, and must not duplicate something already present.
**Applies to:** `**/package.json`, `bun.lock` · **Check:** mechanical · **Severity:** minor
**Flag:** A `package.json`/lockfile change with no source change that uses the dependency, or a library added where the standard one already exists.
**Evidence:** PR #5 `apps/control-api/src/config.ts:1` — "I don't think we need? an external library for this"; PR #5 `apps/control-api/src/logger.ts:13` — a dependency is adopted deliberately ("use something more industry standard like LogTape"), not incidentally.

## 13. Dead code, scaffolding, and cutover

### REPO-DEAD-01 — Delete scratch and temporary artifacts before merge
`tmp/` and other scratch paths are for in-progress work only; a plan, spike note, or proof-of-concept
left in the tree is a finding.
**Applies to:** `tmp/**`, `scripts/**`, `apps/**`, `apis/**` · **Check:** mechanical · **Severity:** minor
**Flag:** A file added under `tmp/`, or a throwaway script left with no owner or invocation.
**Evidence:** PR #4 `tmp/e1-01-plan.md:1` — "Delete"; PR #5 `apps/control-api/src/scripts/dump-openapi.ts:1` — "What's this file doing?" (renamed `generate-openapi` so its purpose is actionable).

### REPO-DEAD-02 — Delete speculative features instead of shipping them
Code for a capability nobody needs yet (an unused route, protocol, or integration) is removed; it can
return when there is a requirement.
**Applies to:** `apps/**`, `apis/**`, `packages/**` · **Check:** judgment · **Severity:** major
**Flag:** A new endpoint, transport, or subsystem the diff does not need and nothing consumes.
**Evidence:** PR #5 `apps/control-api/src/routes/events.ts:1` — "I don't forsee the control API needing SSE for a while - we can drop this for a later time."

### REPO-DEAD-03 — Delete what the change obsoletes, and rename what its purpose changed
Files, shims, aliases, and test suites made redundant by the change are removed in the same change;
a file whose purpose changed is renamed to match.
**Applies to:** `apps/**`, `apis/**`, `packages/**`, `scripts/**` · **Check:** mechanical · **Severity:** major
**Flag:** An obsolete module or compatibility shim left beside its replacement; a file name that no longer states what the file does.
**Evidence:** PR #5 `apps/control-api/src/error.ts:1` — "a file like this shouldn't be explicitly needed anymore"; PR #12 `packages/workflow/src/document/id-splice.ts:1` — "the rest is wrappers … delete this module"; PR #12 `apps/control-api/src/workflows-lifecycle.test.ts:1` — "delete this file"; PR #5 `dump-openapi.ts:1` reply — "rename this file into `generate-openapi`".

## Appendix: rule-to-evidence map

| Rule | Evidence (PR / path) |
| --- | --- |
| REPO-ARCH-01 | #9 `packages/database/src/repositories/workflow-repository.ts:1` |
| REPO-ARCH-02 | #9 `packages/storage/src/database.ts:1` |
| REPO-ARCH-03 | #9 `packages/storage/src/database.ts:1`; #9 `apps/control-api/src/scripts/migrate.ts:1`; #9 `apps/control-api/package.json:12` |
| REPO-ARCH-04 | #12 `packages/workflow/src/document/id-splice.ts:1`; #9 `packages/database/src/schema/database.ts:1` |
| REPO-SLICE-01 | #5 `apps/control-api/src/features/system/get-health.handler.ts:1` |
| REPO-SLICE-02 | #12 `apps/control-api/src/features/workflows/create.ts:68` |
| REPO-SLICE-03 | #12 `apps/control-api/src/workflows/service.ts:317` |
| REPO-SLICE-04 | #5 `apps/control-api/src/routes/system.ts:9`; #12 `apps/control-api/src/workflows/service.ts:317` |
| REPO-SCHEMA-01 | #12 `apps/control-api/src/features/workflows/create.ts:41` |
| REPO-SCHEMA-02 | #12 `apps/control-api/src/features/workflows/create.ts:69` |
| REPO-SCHEMA-03 | #12 `retrieve-version.ts:63`; #12 `rewind.ts:73`; #12 `packages/database/src/repositories/workflow-repository.ts:73` |
| REPO-SCHEMA-04 | #9 `packages/database/src/repositories/workflow-repository.ts:65` |
| REPO-SCHEMA-05 | #12 `packages/database/src/repositories/workflow-repository.ts:73`; #12 `create.ts:41` reply |
| REPO-SCHEMA-06 | #5 `apps/control-api/src/config.ts:1`; #9 `apps/control-api/src/scripts/migrate.ts:6` |
| REPO-TYPE-01 | #12 `apps/control-api/src/features/workflows/retrieve-version.ts:80` |
| REPO-TYPE-02 | #7 `conditional-stage.ts:108`; #12 `create.ts:46`; #9 `workflow-repository.ts:118` |
| REPO-TYPE-03 | #9 `packages/database/src/repositories/workflow-repository.ts:1` reply |
| REPO-CONTRACT-01 | #12 `create.ts:23`; #12 `publish.ts:22`; #12 `retrieve-draft.ts:16`; #12 `retrieve-revision.ts:16` |
| REPO-CONTRACT-02 | #3 `docs/decisions/epic-01/e1-s3-draft-publication-lifecycle.md:135`; #9 `workflow-repository.ts:137` |
| REPO-CONTRACT-03 | #12 `apps/control-api/src/features/workflows/save.ts:25` |
| REPO-CONTRACT-04 | #12 `save.ts:89`; #12 `save.ts:101`; #12 `create.ts:29` |
| REPO-CONTRACT-05 | #12 `apps/control-api/src/features/workflows/publish.ts:69` |
| REPO-CONTRACT-06 | #12 `apps/control-api/src/features/workflows/publish.ts:35` |
| REPO-CONTRACT-07 | #12 `apps/control-api/src/features/workflows/retrieve-draft.ts:24` |
| REPO-NAME-01 | #12 `service.ts:165`; #12 `retrieve-version.ts:63`; #12 `errors.ts:64` |
| REPO-WRITING-01 | #9 `apps/control-api/src/workflows/store.ts:24`; #12 `create.ts:54`; #9 `migrations/002_revisions.ts:32` |
| REPO-NAME-02 | #3 `docs/decisions/epic-01/e1-s3-draft-publication-lifecycle.md:15` |
| REPO-NAME-03 | #5 `apps/control-api/src/features/system/get-version.handler.ts:6` |
| REPO-DOC-01 | #9 `packages/database/src/repositories/workflow-repository.ts:1`; #7 `json-source-parser.ts:155`; #5 `get-health.handler.ts:5` |
| REPO-DOC-02 | #5 `get-health.handler.ts:3`; #12 `apps/control-api/src/app.ts:121` |
| REPO-DOC-03 | #7 `json-source-parser.ts:281`; #7 `json-source-parser.ts:94`; #7 `conditional-stage.ts:37`; #7 `references-stage.ts:144`; #7 `termination-stage.ts:36`; #7 `graph-stage.ts:18` |
| REPO-DOC-04 | #12 `apps/control-api/src/workflows/rule-sets.ts:6` |
| REPO-DOC-05 | #3 `docs/decisions/epic-01/e1-s3-draft-publication-lifecycle.md:15` |
| REPO-TS-01 | #7 `conditional-stage.ts:108`; #9 `workflow-repository.ts:1` reply |
| REPO-TS-02 | #7 `json-source-parser.ts:137`; #7 `conditional-stage.ts:40` |
| REPO-TS-03 | #5 `apps/control-api/src/logger.ts:13`; #5 `apps/control-api/src/app.ts:64` |
| REPO-TS-04 | #7 `conditional-stage.ts:108`; #9 `workflow-repository.ts:1` reply |
| REPO-TS-05 | #2 `docs/decisions/epic-01/e1-s1-workflow-interface-v1.md:251`; #12 `apps/control-api/src/workflows-lifecycle.test.ts:1` |
| REPO-CODE-01 | #7 `json-source-parser.ts:140` |
| REPO-CODE-02 | #12 `apps/control-api/src/app.ts:113` |
| REPO-TEST-01 | #7 `packages/workflow/src/validation/stages/conditional-stage.test.ts:7`; #12 `apps/control-api/src/workflows/documents.test.ts:7` |
| REPO-TEST-02 | #12 `apps/control-api/src/features/workflows/publish.test.ts:30` |
| REPO-TEST-03 | #12 `create.ts:64`, `publish.ts:56`, `retrieve-draft.ts:40`, `retrieve-revision.ts:48`, `retrieve-version.ts:59`, `rewind.ts:65`, `save.ts:86`, `validate.ts:46` |
| REPO-TEST-04 | #12 `apps/control-api/src/features/workflows/publish.test.ts:30` reply |
| REPO-TEST-05 | #12 `apps/control-api/src/workflows/documents.test.ts:7`; #12 `app.test.ts:1`; #12 `loader.test.ts:1`; #12 `server.test.ts:1`; #12 `workflows-lifecycle.test.ts:1` |
| REPO-TEST-06 | #7 `packages/workflow/src/validation/stages/conditional-stage.test.ts:7`; #12 `create.test.ts:26` |
| REPO-TEST-07 | #9 `packages/database/src/repositories/workflow-repository.test.ts:64` |
| REPO-TEST-08 | #9 `packages/database/src/repositories/workflow-repository.test.ts:27` |
| REPO-TEST-09 | #9 `packages/database/src/repositories/workflow-repository.ts:1` reply; #9 `packages/database/src/schema/database.ts:1` |
| REPO-TEST-10 | #9 `packages/workflow/src/fixtures/expected/incomplete/conditional-invalid-operator.json:1` reply |
| REPO-FIXTURE-01 | #9 `packages/workflow/src/fixtures/expected/incomplete/conditional-invalid-operator.json:1` |
| REPO-FIXTURE-02 | #9 `packages/workflow/src/fixtures/expected/incomplete/conditional-invalid-operator.json:1` reply |
| REPO-DB-01 | #9 `packages/storage/migrations/001_workflows.sql:1`; #9 `packages/storage/src/migrator.ts:22` |
| REPO-DB-02 | #9 `packages/database/migrations/README.md:1` reply |
| REPO-DB-03 | #9 `packages/storage/migrations/001_workflows.sql:1` reply |
| REPO-DB-04 | #9 `packages/storage/migrations/001_workflows.sql:1` |
| REPO-DB-05 | #9 `packages/database/migrations/001_workflows.ts:1`; `002_revisions.ts:1`; `003_published_versions.ts:1` |
| REPO-DB-06 | #9 `packages/database/src/repositories/workflow-repository.ts:137` |
| REPO-DB-07 | #9 `packages/database/src/repositories/workflow-repository.ts:231` |
| REPO-DB-08 | #9 `packages/database/src/repositories/workflow-repository.ts:1` reply; #9 `packages/storage/src/storage.ts:19` reply |
| REPO-LIB-01 | #9 `packages/storage/src/uuid-v7.ts:23`; #5 `apps/control-api/src/logger.ts:13`; #5 `apps/control-api/src/config.ts:1` |
| REPO-LIB-02 | #7 `packages/workflow/src/parse/json-source-parser.ts:45`; #12 `packages/workflow/src/document/id-splice.ts:1` |
| REPO-LIB-03 | #9 `packages/storage/src/database.ts:1` reply |
| REPO-DEPS-01 | #5 `apps/control-api/src/config.ts:1`; #5 `apps/control-api/src/logger.ts:13` |
| REPO-DEAD-01 | #4 `tmp/e1-01-plan.md:1`; #5 `apps/control-api/src/scripts/dump-openapi.ts:1` |
| REPO-DEAD-02 | #5 `apps/control-api/src/routes/events.ts:1` |
| REPO-DEAD-03 | #5 `apps/control-api/src/error.ts:1`; #12 `packages/workflow/src/document/id-splice.ts:1`; #12 `apps/control-api/src/workflows-lifecycle.test.ts:1` |
