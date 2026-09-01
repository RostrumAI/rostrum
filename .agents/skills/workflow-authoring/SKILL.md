---
name: workflow-authoring
description: Create, repair, and publish Rostrum workflow JSON through the Control API authoring lifecycle. Use when composing or repairing a workflow document, interpreting Control API validation findings, or saving, rewinding, publishing, and verifying Rostrum workflow drafts.
---

# Workflow authoring

Drive a workflow document from an incomplete draft to an immutable published version through the Control API. The [authoring guide](../../../docs/guides/workflow-authoring.md) walks the same workflow for human readers with full examples; the [workflow interface v1 specification](../../../docs/specs/workflow-interface-v1.md) defines the document shape; and the OpenAPI 3.1 document served at `/openapi.json` (checked in at `apps/control-api/openapi.json`) is the wire-level contract for every endpoint, status, and body.

## Lifecycle operations

| Operation | Request | Behavior |
| --- | --- | --- |
| Validate without saving | `POST /api/v1/workflows/validate` | Body is the bare document. Returns `{ findings, validForPublication }`. Nothing is stored. |
| Create draft | `POST /api/v1/workflows` | Body `{ name?, document }`. The server mints the workflow `id`, replaces any `id` in the document, and stores the first revision. Response `201` is that revision. |
| Save revision | `PUT /api/v1/workflows/{workflowId}/revisions` | Body `{ baseRevision, name?, document }`. Response `200` is the new revision; `baseRevision` must name the current revision. |
| Read current draft | `GET /api/v1/workflows/{workflowId}` | The current revision: exact stored text plus its findings snapshot. |
| Read one revision | `GET /api/v1/workflows/{workflowId}/revisions/{revisionId}` | Exact stored bytes for that revision. |
| Rewind | `POST /api/v1/workflows/{workflowId}/rewind` | Body `{ targetRevisionId }`. Appends a copy of the target as the newest revision (type `rewind`) and makes it current; deletes nothing. Rewinding to the current revision is a `200` no-op. |
| Publish | `POST /api/v1/workflows/{workflowId}/publish` | Publishes the current revision after re-validating it. `201` new version; `200` idempotent repeat; `422` blocking findings, nothing created; `404` missing workflow or revision. |
| Read published version | `GET /api/v1/workflows/{workflowId}/versions/{versionNumber}` | Canonical stored text (full document, metadata included) plus `digest`, `revisionId`, `interfaceVersion`, `versionNumber`. |

Every `4xx` body uses one error shape: `{ code, message, findings, currentRevision? }`. The codes are `invalid_workflow_input` (400: invalid JSON, duplicate keys, `NaN` or `Infinity`, invalid UTF-8 — never stored as a draft), `not_found` and `revision_not_found` (404), `identity_conflict` and `revision_conflict` (409), and `workflow_not_valid` (422, with the blocking findings).

No endpoint lists a draft's revisions. Carry revision ids forward from each create and save response.

## Authoring loop

1. Compose the document against the specification: `interfaceVersion` `"v1"`, a `firstNode`, acyclic steps that each carry exactly one of `successors`, `conditional`, or neither, conditionals as a separate top-level list, bounded `forEach` loops, and `{ "ref": ... }` values that resolve to declared inputs, upstream outputs, or in-scope loop variables.
2. Validate with `POST /api/v1/workflows/validate`. Iterate on the findings before saving anything.
3. Repair from structure, never from message text: match the finding `code`, open the JSON Pointer in `path`, and act on `details` and `relatedLocations` using the repair table below.
4. Save with `PUT /workflows/{workflowId}/revisions`, carrying the `revisionId` you last saw as `baseRevision`; record the response's new `revisionId` for the next save. Syntactically valid JSON saves even with blocking findings, so you can checkpoint unfinished work; only parse failures are rejected.
5. When validation reports `validForPublication: true`, publish with `POST /workflows/{workflowId}/publish`. A `422` sends you back to step 3 with the publish body's findings.
6. Verify the digest (below), then stop. Publishing the same current revision again returns the existing version and is safe.

## Conflicts and concurrency

- A `409` with code `revision_conflict` means the draft moved under you: the body carries `currentRevision` and that revision's findings, and your rejected save created nothing. Read the draft with `GET /workflows/{workflowId}`, reapply your change on top of the returned text, and save again with `currentRevision` as `baseRevision`. Never retry a stale `baseRevision`.
- A `409` with code `identity_conflict` means the saved document's embedded `id` disagrees with the workflow the request addresses. Align the document's `id` or address the intended workflow.
- Rewind appends a copy and deletes nothing, so history stays complete and every published version's source revision remains retrievable. To publish an earlier state, rewind to it and then publish.

## Repair actions by finding code

Match on `code` and repair from `details`; `relatedLocations`, when present, points at the second site of a cross-reference conflict. The validator emits exactly these codes; the committed expected-findings manifests under `packages/workflow/src/fixtures/expected/` assert them.

| Code | `details` carries | Repair |
| --- | --- | --- |
| `workflow.parse.json-invalid` | — | Fix the JSON syntax; the text did not parse. |
| `workflow.parse.duplicate-key` | — | Remove the duplicate object member; last-wins parsing is rejected. |
| `workflow.version.missing` | — | Add `"interfaceVersion": "v1"`. |
| `workflow.version.unknown` | `received`, `supported` | Set `interfaceVersion` to a supported token; there is no fallback. |
| `workflow.shape.required-field` | `schemaPath`, `keyword`, `params.requiredProperties` | Add the named members at the pointer in `path`. |
| `workflow.shape.unknown-field` | `schemaPath`, `params.additionalProperties` | Remove the named members; unknown fields are never ignored. |
| `workflow.shape.type` | `schemaPath`, `keyword`, `params` | Make the value's type match the schema at `schemaPath`. |
| `workflow.shape.format` | `schemaPath`, `params.pattern` | Match the format; identifiers must be UUID v7. |
| `workflow.shape.constraint` | `schemaPath`, `keyword`, `params.limit` | Satisfy the bound: at least one step, `maxIterations >= 1`. |
| `workflow.shape.invalid` | `schemaPath`, `keyword`, `params` | Fix the value the schema at `schemaPath` rejects. |
| `workflow.shape.mutually-exclusive` | `stepId`, `fields` | Keep exactly one of the named fields: `successors` xor `conditional`; `loop` xor `conditional`. |
| `workflow.identity.duplicate-step-id` | `duplicateId`; related location names the first occurrence | Mint a fresh UUID v7 for the second step. |
| `workflow.identity.duplicate-conditional-id` | `duplicateId` | Mint a fresh UUID v7 for the second conditional. |
| `workflow.identity.first-node-unknown` | `firstNode` | Point `firstNode` at an existing step id. |
| `workflow.step.unknown-type` | `stepId`, `received`, `supported` | Use a registered `type` from `details.supported`. |
| `workflow.step.invalid-config` | `stepId`, `type`, `schemaPath`, `keyword`, `params` | Fix `config` against the step type's schema. |
| `workflow.reference.unknown-target` | `stepId` or `conditionalId`, `target`, `field` | Replace the unknown target named in `field` with an existing step id; mint a new step when the edge needs one. |
| `workflow.graph.cycle` | `cycle` (step ids; the first repeats last); loop-body cycles add `loop` | Remove or repoint one edge in the listed cycle. |
| `workflow.graph.unreachable-dependency` | `step`, `dependency`; related location names the dependency step | Make the dependency reachable on every path to `step`, or remove it. |
| `workflow.loop.nested` | `outerLoop`, `innerLoop` | Remove the inner `loop`; v1 forbids nesting. |
| `workflow.loop.invalid-max-iterations` | `stepId`, `received` | Set `maxIterations` to an integer of at least 1. |
| `workflow.conditional.empty-branches` | `conditionalId` | Declare at least one branch. |
| `workflow.conditional.empty-group` | `conditionalId` | Give the `all` or `any` group at least one condition. |
| `workflow.conditional.missing-dependency` | `conditionalId`, `referencedStep`, `ref` | Add `referencedStep` to the conditional's `dependencies`. |
| `workflow.conditional.unknown-step` | `conditionalId`, `stepId` | The condition references a step that does not exist; fix the ref or the step. |
| `workflow.conditional.invalid-operator` | `conditionalId`, `operator` | Use a supported operator: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `notin`, `contains`, `truthy`, `falsy`. |
| `workflow.conditional.invalid-ref` | `conditionalId`, `ref` | Leaf condition refs must be `step.<stepId>.<output>`. |
| `workflow.termination.non-result-terminal` | `stepId`, `received` | Type the terminal step `result`, or give it a successor. |
| `workflow.termination.unterminated-path` | `stepId` | Route the path to a terminal `result` step or an end-workflow branch (omit the branch's `next`). |
| `workflow.reference.invalid-syntax` | `stepId`, `ref` | Refs must be `inputs.<name>`, `step.<stepId>.<output>`, or `loop.<variable>`. |
| `workflow.reference.unknown-input` | `stepId`, `ref`, `input` | Declare the workflow input or correct the name. |
| `workflow.reference.unknown-step` | `stepId`, `ref`, `targetStep` | The referenced step does not exist; correct the ref. |
| `workflow.reference.unknown-output` | `stepId`, `ref`, `targetStep`, `output` | Declare the output on the producer or correct the name. |
| `workflow.reference.not-upstream` | `stepId`, `ref`, `targetStep` | Reorder the graph so the producer completes before the consumer. |
| `workflow.reference.loop-out-of-scope` | `stepId`, `ref` | Loop variables resolve only inside the loop body. |

Every code above is blocking in v1. The validator emits no type-compatibility findings: the `workflow.io.type-mismatch` code is reserved for a future interface version, so a workflow whose producer and consumer declare incompatible types publishes cleanly and may fail at run time.

## Digest verification

After a successful publish, verify that the stored digest identifies what you think it does:

1. Retrieve the version with `GET /workflows/{workflowId}/versions/{versionNumber}`.
2. Parse `content`, delete the `name` and `description` members, canonicalize with RFC 8785, and hash with SHA-256 (lowercase hex).
3. Compare with the response's `digest`.

Run from the repository root:

```bash
bun -e 'import { canonicalize } from "./packages/workflow/src/index.ts";
import { createHash } from "node:crypto";
const [workflowId, versionNumber] = Bun.argv.slice(2);
const response = await fetch(
  `http://127.0.0.1:3000/api/v1/workflows/${workflowId}/versions/${versionNumber}`,
);
const version = await response.json();
const document = JSON.parse(version.content);
delete document.name;
delete document.description;
const digest = createHash("sha256").update(canonicalize(document)).digest("hex");
console.log(digest === version.digest ? "digest verified" : `digest mismatch: ${digest}`);' \
  WORKFLOW_ID VERSION_NUMBER
```

The digest covers the definition only: a metadata-only edit (to `name` or `description` alone) publishes a new version whose digest equals the previous version's, while any other edit changes it. Unicode is not normalized, so NFC and NFD spellings of the same text hash differently. A changed digest means a definitional change; an unchanged digest means the definition is identical.
