# PR #12 review response plan

Branch `e1-06` (head 6cdf42ae) · RostrumAI/rostrum#12 · 67 comments from @Stephen-PP in two waves: 2026-08-28 (commit 8709546) and 2026-09-01 (commit 6cdf42a).

Legend: [x] already addressed on the branch, verified against the working tree · [ ] open — this plan.

## Open items from the 2026-09-01 wave

### 1. Note the OpenAPI builders — app.ts:121, 145, 166 (r3899852097, r3899851914, r3899851734)

`describeFeature` (app.ts:121), `describeResponses` (app.ts:145), and `describeRequestBody` (app.ts:166) build the per-route `DescribeRouteOptions` the loader hands to hono-openapi; the `GET /openapi.json` route assembles them via `generateSpecs` (app.ts:87-108).

- Change: extend each helper's TSDoc with "Used for building OpenAPI JSON output."
- Replies posted to the first and third comments (app.ts:121 and app.ts:166).

### 2. Split publish status codes — publish.ts (r3899734556)

Today both outcomes return 200 with an identical body (publish.ts:63-72, single "200" response at publish.ts:28-32).

- `published` → 201, `already-published` → 200, identical body in both cases.
- publish.ts: add "201" and "200" to `route.responses`; the handler switch returns 201 for `published`, 200 for `already-published`.
- publish.test.ts: "publishes and answers 200 with the version identity" asserts 201; the idempotent re-publish test asserts 200 with the same body.
- Regenerate the contract: `bun run generate-openapi` in apps/control-api; the CI smoke stage asserts served == checked-in openapi.json, so both change together.

### 3. Rename "envelope" — create.ts:54 (r3899710687)

Adopt the standard term "request body". Mechanical rename plus prose, grounded by a repo-wide grep:

- apps/control-api/src/workflows/request-body.ts: `readEnvelopeBody` → `readRequestBody` (return member `envelope` → `request`), `envelopeError` → `requestBodyError`, TSDoc updated.
- Call sites and prose: create.ts (:6, :21, :32, :54, :57), save.ts (:11, :20, :29, :48, :77, :81-82), rewind.ts (:29, :48), create.schema.ts (:6 comment), workflows/schemas.ts (:56, :137, :143 comments).
- Test names/messages: create.test.ts (:36, :58), save.test.ts (:74), rewind.test.ts (:72), errors.test.ts (:51 message string).
- Regenerate openapi.json (descriptions mirror route bindings).

### 4. Document create idempotency — create.test.ts:26 (r3899704602)

Behavior today: every POST mints a fresh workflow id in `WorkflowService.createDraft` (`mintUuidV7()`, service.ts:95) and creates an independent draft — two calls produce two drafts with two 201s. Creation is not idempotent: E1-S3 gives create no idempotency key, and the server is the only id authority.

- Add a test asserting two POSTs answer 201 with distinct workflow ids (stub returns a distinct draft per call).

### 5. State handler-test intent — publish.test.ts:30 and six "same comment" files (r3899722718, r3899744513, r3899744996, r3899745417, r3899745716, r3899746131, r3899746348)

The tests stub the service (`servicesWith`, testing/handlers.ts:30) and assert status + body. What they actually verify: outcome→status mapping, single-error-shape mapping, body contract shape, malformed path param 400 via `parameterGuard`, envelope schema 400s. The reviewer's risk — "just stubbing the response and asserting on it" — is real for field-copy bodies unless the request-parsing half is asserted.

- Make each service stub a `mock()` and assert call count + arguments (workflowId from the path; baseRevision/name from the parsed body). The handler's parsing half becomes asserted, not just the mapping half.
- Keep body assertions as contract shapes (the `revisionResponseShape()` pattern in create.test.ts:70).
- Files: publish, create, save, validate, rewind, retrieve-draft, retrieve-revision, retrieve-version `.test.ts`.
- Reply to the publish.test.ts:30 comment describing the test's intent once strengthened.

### 6. Rename `publishedVersion` → `getPublishedVersion` — retrieve-version.ts:63 (r3899762982)

- Rename the `WorkflowService` method; caller is retrieve-version.ts:63. Run LSP references before renaming to catch all callsites. Aligns with the store-side `getPublishedVersion` name already referenced in rule-sets.ts:8.

## Already addressed (verified on the branch)

| Wave-1 comment | Evidence |
| --- | --- |
| Per-slice handler tests; delete app/loader/server/workflows-lifecycle suites | Per-slice `*.test.ts` exist; the four suites are gone; full-flow coverage moved to docs/tasks/epic-02/e2-13-add-authoring-lifecycle-integration-tests.md |
| CI smoke instead of boot tests | src/scripts/smoke.ts; ci.yml smoke stage checks health, /openapi.json, contract equality |
| Factory DI, no singleton | `createHandler(services)` in all eight slices; Services built at boot (services.ts); lazy singleton and test seam removed |
| Smallest-scope schemas | create.schema.ts / save.schema.ts colocated; shared schemas in workflows/schemas.ts; ErrorResponse in src/schemas.ts |
| Save is PUT, params in body | save.ts:25-31 (method, requestBody), no headers read anywhere |
| Unreachable collision guard removed | workflow-repository.ts:70 accepts the caller-assigned id (`input.workflowId ?? mintUuidV7()`) |
| Generic helper names | errors.ts uses `workflowNotFound`, `workflowRevisionNotFound`, `workflowIdentityConflict`, … |
| Schema-validator checks | `parameterGuard` answers 400 for malformed path params before handlers (publish.test.ts:85 covers it) |
| Stepwise describeFeature | app.ts:122-141 builds tag/responses, then parameters, then requestBody |
| Stricter return types | Handler bodies typed `Static<typeof …ResponseSchema>` |
| rule-sets.ts TSDoc file references | Now symbol references only (rule-sets.ts:3-12) |
| Byte-faithful input (exact bytes vs canonical JSON) | Kept per contract defense (r3885362223); reviewer did not re-raise |
| Publish response shape | Kept per E1-06 contract text ("returns the workflow ID, published version, interface version, and digest"); `workflowId` echo retained pending reviewer confirmation |
| 403/500 documentation | 500 contract-wide via app `onError`; 403 deferred until auth exists; global OpenAPI note only if the reviewer confirms |
| UUIDv7 mentions in app sources | Removed from prose; only the `mintUuidV7` import alias remains (service.ts:20, workflow-repository.ts:5) — an identifier, not a mention; docs keep theirs by design |

Open without direction: "get rid of this rule set bullshit" (r3884615161). The registry wiring is the E1-S4 design for multi-version selection; needs the reviewer's concrete intent before touching it.

## Sequencing

1. Items 1, 3, 6 — mechanical comments and renames, one commit.
2. Items 2 and 4 — publish status split + idempotency test, regenerate openapi.json, one commit.
3. Item 5 — test-intent audit across the eight per-slice test files, one commit.

## Verification

- `bun test` in apps/control-api (all eight per-slice suites, errors.test.ts).
- `bun run typecheck` in apps/control-api.
- `bun run lint`
- `bun run generate-openapi` — the committed openapi.json diff matches exactly the description/status changes.
- CI smoke stage re-proves boot + served contract equality; full-flow integration coverage lands with E2-13 by agreement.
