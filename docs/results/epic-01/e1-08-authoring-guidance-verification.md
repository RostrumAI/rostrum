# E1-08 result: Authoring-guidance verification

| Tracking | Value |
| --- | --- |
| Task | [E1-08: Document workflow authoring for humans and agents](../../tasks/epic-01/e1-08-publish-workflow-authoring-guidance.md) |
| Status | Verified |
| Last updated | 2026-09-01 |

## What this record proves

Two independent authors each moved the same incomplete fixture to an immutable published version following only the documented guidance, with no access to implementation source:

- a human-path walkthrough of [the authoring guide](../../../docs/guides/workflow-authoring.md);
- an automated agent following [the workflow-authoring skill](../../../.agents/skills/workflow-authoring/SKILL.md).

Every API behavior the guidance documents was exercised against the running Control API at `http://127.0.0.1:3000/api/v1` (embedded single-node Postgres on the default port, the same start the test suite uses; Docker was unavailable on the verification machine). The guidance's example documents run in the shared validation suite: `bun test packages/workflow` covers every fixture the guide cites, the repaired walkthrough counterpart's digest vector, and the dual-implementation digest check.

## Corrections the walkthroughs forced

The first pass drafted examples from the contract and decisions; execution corrected them before commit:

- **Create envelope**: `POST /workflows` takes `{ name?, document }`, not a bare document; the guide's command builds the envelope with `jq`.
- **Digest command arguments**: `bun -e` places script arguments starting at `Bun.argv[1]`, so the documented command slices from 1.
- **Advisory type mismatch**: the compatibility stage emits nothing in v1; `workflow.io.type-mismatch` is reserved, never emitted. Guide and skill state this.
- **Revision checkpoint labels**: the repository dropped the optional `name` on create and save, contradicting the contract; fixed and covered by a repository test (`workflow-repository.test.ts`).
- **Specification accuracy**: stale fixture paths (`tests/fixtures/` → `src/fixtures/`) and the `unfinished-connection` claim about stage-6 findings (the termination stage is gated; only the stage-3 finding appears) were corrected in the spec.

## Human walkthrough

Workflow `01a05c29-697a-71ba-87fe-d40f966e2b8e`; steps in the guide's order. Each step is one documented request; observed statuses and ids:

| # | Step | Result |
| --- | --- | --- |
| 1 | `POST /workflows` with the incomplete fixture in the envelope | `201`; workflowId `01a05c29-...2b8e`, revision `01a05c29-...0405`, one blocking finding `workflow.reference.unknown-target` (line 11, column 11 of the stored text) |
| 2 | `POST /workflows/validate` on the fixture | `200`; same code, line 10, column 28 of the submitted text; `validForPublication: false` |
| 3 | `PUT .../revisions` repaired document, `baseRevision` set, labeled `first repair` | `200`; revision `01a05c29-...1087`, `name: "first repair"`, findings empty |
| 4 | Replay of step 3's exact save | `409` `revision_conflict`; body carries `currentRevision` `01a05c29-...1087` and its findings; nothing overwritten |
| 5 | `POST .../rewind` to the first revision | `200`; new revision `01a05c29-...f064`, `type: "rewind"`, findings snapshot carried |
| 6 | `POST .../publish` the incomplete current revision | `422` `workflow_not_valid`; nothing created |
| 7 | Rewind to the repaired revision | `200`; revision `01a05c29-...0d2`, findings empty |
| 8 | `POST .../publish` | `201`; version 1, `interfaceVersion` `"v1"`, digest `fa281553b0b069636ccb10845e0466215ff00613f1541935eb7b51d8b512db85` |
| 9 | Repeat publish | `200`; byte-identical body |
| 10 | Metadata-only edit (`name`, `description`), saved with label `renamed for display` | `200`; revision `01a05c29-...2730`, findings empty |
| 11 | Publish the renamed revision | `201`; version 2, digest equal to version 1's |
| 12 | Documented digest command on versions 1 and 2 | `digest verified` twice |
| 13 | `GET .../versions/1`, `GET .../workflows/{id}`, `GET .../revisions/{first}` | `200`; canonical version bytes, current draft (renamed), original revision bytes intact |
| 14 | Save with a duplicate-key body | `400` `invalid_workflow_input`; never a draft |

## Automated agent walkthrough

A task subagent received only the skill (and, through it, the guide), the fixture path, and the API base URL. Workflow `01a05c2f-159d-706e-8716-bebb2da64f27`. The agent's transcript, condensed:

1. Created a fresh draft: `201`, read the finding by `code` and `details` (`field: successors`, `target: ...099`), confirmed the server-assigned `id` was spliced into the stored text.
2. Sent the envelope to the validate endpoint by mistake → `400` `workflow.parse.json-invalid`; corrected to the bare-document body the skill documents.
3. Repaired per the skill's table: minted a new terminal `result` step, repointed the successor, kept the server-assigned workflow id.
4. Saved labeled `agent repair`; its own retry of the identical save hit `409` `revision_conflict`, and it recovered exactly as documented: re-read the draft, then save against `currentRevision`. The conflict recovery path was exercised by the agent's real mistake, not a staged one.
5. Published: `201`, version 1, digest `238cc6971cafa9f16c2d9c8c35cde4f079f89a7895abefb29ca6d6c1a7a67d63`; repeat publish `200`, byte-identical.
6. Reproduced the digest with the documented command: `digest verified`.

The agent needed no undocumented behavior; both of its errors were answered by documented error shapes it could act on.

## Acceptance criteria

- The guidance explains the minimum, sequential, and branching examples and the five E1-S1 representative workflows — guide's "Example documents" and "The v1 document in brief", all fixture-backed and suite-run.
- The guidance shows how to save and retrieve an incomplete draft, interpret its findings, and revise from a specific finding code and details — guide's create, validate, interpret, and revise sections, exercised in walkthrough steps 1–3.
- The guidance documents `baseRevision` conflict handling (409), rewind semantics, and how to publish earlier state by rewinding first — guide's conflict and rewind sections, exercised in steps 4–7.
- The guidance documents the digest rule (RFC 8785, metadata excluded) and metadata-only edit behavior — guide's digest section, exercised in steps 10–12.
- Every API behavior it uses is public and documented in the OpenAPI 3.1 contract — the guide and skill cite `apps/control-api/openapi.json`; the walkthrough's statuses and bodies matched it throughout.
- The automated-author instructions use structured validation results (`code` and `details`) and the same lifecycle operations — the skill's repair table is drawn from the committed expected-findings manifests; the agent transcript shows code-based repair.
- A human and an automated coding agent can each revise an incomplete draft into a published workflow by following the guidance — both transcripts above.
- Examples used by the guidance run as part of the shared validation suite from [E1-05](../../tasks/epic-01/e1-05-build-workflow-example-validation-suite.md) — `bun test packages/workflow` (253 tests) including the coverage test that requires every valid fixture to carry a digest vector.
