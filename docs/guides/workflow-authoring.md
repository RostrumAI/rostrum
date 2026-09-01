# Author workflows through the Control API

This guide explains how to take a workflow JSON document from an incomplete draft to an immutable published version through the Control API: creating a draft, interpreting validation findings, saving revisions, resolving save conflicts, rewinding, publishing, and verifying the published digest. Every endpoint, status code, and response body shown here is defined in the OpenAPI 3.1 contract that the API serves at `/openapi.json` and that is checked in at `apps/control-api/openapi.json`.

For the complete document contract, see the [workflow interface v1 specification](../specs/workflow-interface-v1.md). This guide covers the authoring workflow around that document, not the document shape itself. Automated coding agents can follow the same workflow through the [workflow-authoring skill](../../.agents/skills/workflow-authoring/SKILL.md).

## Before you start

You need:

- [Bun](https://bun.sh) 1.x and a checkout of this repository
- [Docker](https://www.docker.com), for the local Postgres service
- [jq](https://jqlang.github.io/jq/), for the field-extraction steps in the examples

Start the database and the Control API:

```bash
bun install
bun run db:up
bun run db:migrate
bun run --filter @rostrum/control-api start
```

The API listens at `http://127.0.0.1:3000/api/v1` by default. Substitute your own host and port if you changed the configuration.

## The v1 document in brief

A workflow document is a single JSON object that declares an `interfaceVersion` (`"v1"`), an `id` (UUID v7), a `name`, a `firstNode`, named `inputs`, an unordered list of `steps`, and a separate top-level list of `conditionals`. Each step carries exactly one of `successors`, `conditional`, or neither, and may add a bounded `loop`. The graph must be acyclic, every path must end at a terminal `result` step or an end-workflow branch, and every `{ "ref": "..." }` must resolve to a declared input, an upstream step output, or an in-scope loop variable.

The authored document carries no lifecycle fields: revision ids, version numbers, and digests are assigned by the server. The [document structure section](../specs/workflow-interface-v1.md#document-structure) of the specification defines every field.

## Example documents

The examples in this guide come from the shared validation suite in `packages/workflow/src/fixtures/`, so each document shown here is exercised by the suite:

| File | Document |
| --- | --- |
| `fixtures/valid/sequential.json` | Sequential workflow with a terminal result |
| `fixtures/valid/minimum.json` | Smallest publishable workflow: one terminal step |
| `fixtures/valid/conditional-branching.json` | Conditional branching with two terminal results |
| `fixtures/valid/fan-out-fan-in.json` | Parallel fan-out that joins through dependencies |
| `fixtures/valid/bounded-loop.json` | Bounded `forEach` loop over a collection |
| `fixtures/valid/conditional-groups.json` | `all` and `any` condition groups |
| `fixtures/incomplete/unfinished-connection.json` | Draft with a blocking finding (used throughout this guide) |
| `fixtures/valid/unfinished-connection-repaired.json` | The repaired counterpart of the incomplete draft |

The remaining valid and invalid examples in the suite demonstrate one rule each; the specification's [examples section](../specs/workflow-interface-v1.md#examples) lists them.

## Create a draft

Creation and the first save are one operation. The create body wraps the document in a `document` member; send the fixture through `jq` to build the envelope:

```bash
jq '{ document: . }' packages/workflow/src/fixtures/incomplete/unfinished-connection.json \
  | curl -sS -X POST http://127.0.0.1:3000/api/v1/workflows \
      -H "Content-Type: application/json" --data-binary @- \
  | jq
```

The example document names a successor step that does not exist, so it saves with a blocking finding:

```json
{
  "workflowId": "01a05c29-697a-71ba-87fe-d40f966e2b8e",
  "revisionId": "01a05c29-697b-718b-8b6e-fc220cca0405",
  "name": null,
  "type": "save",
  "findings": [
    {
      "code": "workflow.reference.unknown-target",
      "message": "successors '0192b0a0-7e1d-7000-8000-000000000099' does not reference an existing step",
      "blocking": true,
      "path": "/steps/0/successors/0",
      "line": 11,
      "column": 11,
      "details": {
        "stepId": "0192b0a0-7e1d-7000-8000-000000000051",
        "target": "0192b0a0-7e1d-7000-8000-000000000099",
        "field": "successors"
      }
    }
  ]
}
```

The response's `content` member (omitted above for readability) carries the stored text: the submitted document with the server-assigned `id` spliced in and every other byte preserved. This run stored:

```json
{
    "interfaceVersion": "v1",
    "id": "01a05c29-697a-71ba-87fe-d40f966e2b8e",
    "name": "Unfinished workflow",
    "firstNode": "0192b0a0-7e1d-7000-8000-000000000051",
    "steps": [
      {
        "id": "0192b0a0-7e1d-7000-8000-000000000051",
        "type": "task",
        "successors": [
          "0192b0a0-7e1d-7000-8000-000000000099"
        ]
      }
    ]
  }
```

Three properties of this response matter for the rest of the workflow:

- The `workflowId` is assigned by the server. Any `id` in the document you submitted is replaced, never honored.
- Syntactically valid JSON saves even when validation reports blocking findings. You do not need a correct document to open a draft.
- `revisionId` identifies the revision the draft is showing now. Keep it: later saves must carry it as `baseRevision`, and there is no endpoint that lists a draft's revisions.

The body also accepts an optional `name` member to label the first revision. A finding's `line` and `column` anchor to the stored text that retrieval returns.

## Validate without saving

To check a document without storing anything, send it to `POST /workflows/validate`. The response carries the same findings a save would return for the same text, plus a `validForPublication` flag:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/v1/workflows/validate \
  -H "Content-Type: application/json" \
  --data-binary @packages/workflow/src/fixtures/incomplete/unfinished-connection.json \
  | jq
```

```json
{
  "findings": [
    {
      "code": "workflow.reference.unknown-target",
      "message": "successors '0192b0a0-7e1d-7000-8000-000000000099' does not reference an existing step",
      "blocking": true,
      "path": "/steps/0/successors/0",
      "line": 10,
      "column": 28,
      "details": {
        "stepId": "0192b0a0-7e1d-7000-8000-000000000051",
        "target": "0192b0a0-7e1d-7000-8000-000000000099",
        "field": "successors"
      }
    }
  ],
  "validForPublication": false
}
```

Use this operation while composing a document, and save when the findings are gone.

## Interpret findings

Each finding is a structured object. The fields are the contract; the `message` text is not:

| Field | Meaning |
| --- | --- |
| `code` | Stable dot-namespaced identifier, such as `workflow.graph.cycle`. Match on this, not on the message. |
| `message` | Human-readable explanation. |
| `blocking` | `True if the finding prevents publication; false otherwise.` Every finding the validator emits in v1 is blocking; the reserved `workflow.io.type-mismatch` code is not emitted in v1 at all. |
| `path` | JSON Pointer (RFC 6901) to the offending part of the document, or `""` for a document-level problem such as a cycle. |
| `line`, `column` | One-based location in the text being validated: the submitted document for a validation request, the stored text for a draft or revision. |
| `relatedLocations` | Additional `{ path, message }` pointers for cross-reference conflicts, such as the two steps involved in an unreachable dependency. |
| `details` | Structured context for repair without parsing the message: the step ids, received values, and supported values involved. |

Findings are sorted by `path` and then by `code`, so the same document always yields the same order.

The pipeline runs eight stages in a fixed order, and a stage runs only when no earlier stage produced a blocking finding. When a document has shape errors, the response contains only shape findings; the graph and termination stages emit nothing because their input is not trustworthy. The [validation section](../specs/workflow-interface-v1.md#validation) of the specification lists every stage and every code.

### Revise from a finding

Repair from `code` and `details`. For the running example, `workflow.reference.unknown-target` reports `details.field` as `successors`, `details.stepId` as the step that points forward, and `details.target` as the id that does not exist. The repair is to replace the unknown target with a real step: add a terminal `result` step and name it as the successor. The repaired document is committed as `fixtures/valid/unfinished-connection-repaired.json`:

```json
{
  "interfaceVersion": "v1",
  "id": "0192b0a0-7e1d-7000-8000-000000000050",
  "name": "Unfinished workflow",
  "firstNode": "0192b0a0-7e1d-7000-8000-000000000051",
  "steps": [
    {
      "id": "0192b0a0-7e1d-7000-8000-000000000051",
      "type": "task",
      "successors": ["0192b0a0-7e1d-7000-8000-000000000052"]
    },
    {
      "id": "0192b0a0-7e1d-7000-8000-000000000052",
      "type": "result",
      "inputs": {}
    }
  ]
}
```

The suite proves the repaired shape; the fixture carries the fixture's own `id`. When you save the repair to a draft, keep that draft's server-assigned `id` in the document — an embedded `id` that disagrees with the addressed workflow is a `409` identity conflict. After the save, the response's `findings` array comes back empty.

## Save a revision

Every save creates a new revision. Send the document to `PUT /workflows/{workflowId}/revisions` with the revision id you last saw as `baseRevision`:

```bash
curl -sS -X PUT "http://127.0.0.1:3000/api/v1/workflows/WORKFLOW_ID/revisions" \
  -H "Content-Type: application/json" \
  -d '{
        "baseRevision": "REVISION_ID",
        "name": "first repair",
        "document": { "interfaceVersion": "v1", "id": "WORKFLOW_ID", "name": "Unfinished workflow", "firstNode": "0192b0a0-7e1d-7000-8000-000000000051", "steps": [ { "id": "0192b0a0-7e1d-7000-8000-000000000051", "type": "task", "successors": ["0192b0a0-7e1d-7000-8000-000000000052"] }, { "id": "0192b0a0-7e1d-7000-8000-000000000052", "type": "result", "inputs": {} } ] }
      }'
```

Replace `WORKFLOW_ID` with the draft's `workflowId` and `REVISION_ID` with the revision id you last saw. The optional `name` labels the revision in the draft's history. A successful save returns `200` with the new revision: its `revisionId` is the next `baseRevision`, and its `findings` array describes the new document. This walkthrough's save returned (the full revision shape matches the create response):

```json
{
  "revisionId": "01a05c29-69f6-76bc-9f83-15fc6cb21087",
  "name": "first repair",
  "type": "save",
  "findings": []
}
```

Two save behaviors are deliberate:

- A save of syntactically valid JSON succeeds even when the document has blocking findings, so you can checkpoint unfinished work. Draft saves fail only when the text cannot be parsed at all: invalid JSON, duplicate keys, `NaN` or `Infinity` literals, or invalid UTF-8 return `400` with the error code `invalid_workflow_input`.
- The save commits only when `baseRevision` still names the draft's current revision. Otherwise it returns `409` and overwrites nothing. See the next section.

## Resolve a save conflict

A `409` means the draft moved under you. The body uses the single error shape with one of two codes:

- `revision_conflict`: another save created a newer revision first. The body carries `currentRevision` (the id of the revision that is current now) and that revision's findings.
- `identity_conflict`: the saved document's embedded `id` disagrees with the workflow the request addresses.

Replaying the walkthrough's first save against the updated draft answered:

```json
{
  "code": "revision_conflict",
  "message": "The draft has newer work: the saved revision is not the current one. Re-read the current revision, then retry.",
  "findings": [],
  "currentRevision": "01a05c29-69f6-76bc-9f83-15fc6cb21087"
}
```

To recover from a `revision_conflict`:

1. Read the draft's current state with `GET /workflows/{workflowId}`. The response carries the current revision's exact text and findings.
2. Reapply your change on top of that text.
3. Save again with the returned revision id as `baseRevision`.

No partial write survives a conflict: the rejected save created nothing, so re-saving from the current revision loses no work.

## Rewind the draft

Rewinding makes an earlier revision the draft's current state. Send the target revision to `POST /workflows/{workflowId}/rewind`:

```bash
curl -sS -X POST "http://127.0.0.1:3000/api/v1/workflows/WORKFLOW_ID/rewind" \
  -H "Content-Type: application/json" \
  -d '{ "targetRevisionId": "REVISION_ID" }'
```

The server appends a copy of the target revision as the newest revision, marks it `type: "rewind"`, and makes it current. Nothing is deleted: the target and every newer revision remain retrievable, and rewinding to the current revision is a `200` no-op. The response is the appended copy — the walkthrough's rewind to the first revision carried the target's exact bytes and its findings snapshot:

```json
{
  "revisionId": "01a05c29-6a7e-721c-9510-0bbb5416f064",
  "name": null,
  "type": "rewind",
  "findings": [
    {
      "code": "workflow.reference.unknown-target",
      "path": "/steps/0/successors/0"
    }
  ]
}
```

To publish an earlier state, rewind to it and then publish. Because rewind appends rather than deletes, the draft's history stays complete and every published version's source revision remains retrievable.

## Publish the draft

Publishing releases the draft's current revision as an immutable version. Send `POST /workflows/{workflowId}/publish` with no body:

```bash
curl -sS -X POST "http://127.0.0.1:3000/api/v1/workflows/WORKFLOW_ID/publish"
```

The server re-runs the full validation pipeline on the stored content before anything is stored:

- `201`: the revision validated and was canonicalized (RFC 8785) and stored as a new immutable version. The body carries the `workflowId`, the `versionNumber` (1, 2, 3, ...), the `interfaceVersion` the content satisfies, and the `digest`.

The walkthrough's publish answered:

```json
{
  "workflowId": "01a05c29-697a-71ba-87fe-d40f966e2b8e",
  "versionNumber": 1,
  "interfaceVersion": "v1",
  "digest": "fa281553b0b069636ccb10845e0466215ff00613f1541935eb7b51d8b512db85"
}
```

Republishing the same revision returned `200` with a byte-identical body.
- `200`: the current revision was already published; the response is the existing version, unchanged and identical to the first publish's body. Publishing the same revision again is safe.
- `422` with code `workflow_not_valid`: the current revision has blocking findings. Nothing is created and the body carries the findings.
- `404` with code `not_found` or `revision_not_found`: the workflow does not exist or has no current revision.

Editing the draft after publishing never touches published versions: further saves create new revisions, and further publishes create new versions.

## Verify the digest

The `digest` identifies the workflow's definition: it is the SHA-256 hash (lowercase hex) of the document's RFC 8785 canonical form with the metadata members `name` and `description` removed. A display-only edit to those two members can mint a new version, but that version's digest equals the previous version's digest, so callers comparing digests see that the definition is unchanged.

Retrieve a published version with `GET /workflows/{workflowId}/versions/{versionNumber}`. The response carries the stored canonical `content` (the full document, metadata included), the `digest`, the `revisionId` it came from, and the `versionNumber`. The bytes are verified at retrieval by digest recomputation.

To reproduce the digest yourself, remove the two metadata members from the retrieved document, canonicalize with RFC 8785, and hash:

```bash
bun -e 'import { canonicalize } from "./packages/workflow/src/index.ts";
import { createHash } from "node:crypto";
const [workflowId, versionNumber] = Bun.argv.slice(1);
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

Run this from the repository root, replacing `WORKFLOW_ID` and `VERSION_NUMBER` with the publish response's values. The command prints `digest verified` when the retrieved bytes hash to the stored digest.

The digest rule has consequences worth knowing before you edit:

- Only `name` and `description` are metadata in v1. Any other edit, including to a step label, changes the digest.
- Unicode is not normalized: the same text in NFC and NFD form produces different digests.
- Numbers canonicalize the ECMAScript way (`1.0` becomes `1`, `-0` becomes `0`), and object member order is irrelevant, so reformatting a document never changes its digest.
- Duplicate keys are rejected at save, because last-wins parsing would make digests nondeterministic.

## Limits of v1

The validator's data-reference checks verify that each reference resolves and that the producing step completes before the consumer. They do not compare the producer's and consumer's schema fragments. A workflow whose step produces a string where the next step expects a number publishes cleanly and may fail at run time. The validator reports no type mismatch in v1: the `workflow.io.type-mismatch` code is reserved for a future interface version that makes type compatibility blocking.

Also true in v1, by contract:

- Loops are bounded `forEach` only; `while` and `until` loops and nested loops are not expressible.
- A dependency must be reachable on every path from `firstNode` to the dependent step (the merge-after-branch restriction).
- Step types are limited to the registered set; `task` and `result` exist in v1.
- No endpoint lists a draft's revisions. Revision ids come from the create and save responses.
