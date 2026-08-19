# E1-08: Document workflow authoring for humans and agents

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-19 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-05](e1-05-build-workflow-example-validation-suite.md), [E1-06](e1-06-add-control-api-workflow-operations.md) |

## Task

This task creates tested workflow-authoring instructions that reflect the contracts in [E1-S1](../../decisions/epic-01/e1-s1-workflow-interface-v1.md), [E1-S2](../../decisions/epic-01/e1-s2-validation-behavior.md), [E1-S3](../../decisions/epic-01/e1-s3-draft-publication-lifecycle.md), and [E1-S4](../../decisions/epic-01/e1-s4-interface-versioning-methodology.md). The instructions explain how to:

- Create minimum, sequential, and branching workflow JSON using the v1 shape (UUID v7 identifiers, `interfaceVersion: "v1"`, `firstNode`, `steps` with `successors`/`conditional`/`loop`, conditionals as a separate top-level list with `branches` and `default`, bounded `forEach` loops).
- Save and retrieve an incomplete draft — the server mints the workflow `id` on creation and returns it; later saves use that `id` and carry `baseRevision` for optimistic concurrency. Syntactically valid JSON saves despite blocking findings; parse failures (invalid JSON, duplicate keys) do not.
- Interpret structured validation findings — each finding carries a stable `code`, `message`, `blocking`, JSON Pointer `path`, `line`/`column` when text is available, `relatedLocations`, and structured `details` ordered by pointer then code. Later stages are gated when prerequisites block.
- Revise the draft from findings and handle a 409 conflict by re-reading the current revision; rewind the draft to an earlier revision when you want to publish earlier state.
- Publish the current revision, verify idempotent repeat publish of the same revision, and confirm that metadata-only edits (`name`, `description`) leave the digest unchanged.
- Retrieve and verify the published version — SHA-256 hex over the RFC 8785 canonical form with metadata members removed.

The task also creates a first Rostrum authoring skill or equivalent instructions for automated coding agents. The skill uses structured findings (`code` and `details`) for repair, not message text, and honors `baseRevision` and rewind.

## End state

- A human or automated author can turn an incomplete draft into a published workflow using only documented behavior and tested examples, including conflict handling, rewind, and digest verification.

## Why

- Authors need instructions that exercise the same specification, API, and validation results implemented by Rostrum.

## Blocks

- [E1-09: Prove draft-to-publication behavior end to end](e1-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- The guidance explains the minimum, sequential, and branching examples and the five E1-S1 representative workflows.
- The guidance shows how to save and retrieve an incomplete draft, interpret its findings, and revise from a specific finding code and details.
- The guidance documents `baseRevision` conflict handling (409), rewind semantics, and how to publish earlier state by rewinding first.
- The guidance documents the digest rule (RFC 8785, metadata excluded) and metadata-only edit behavior.
- Every API behavior it uses is public and documented in the OpenAPI 3.1 contract.
- The automated-author instructions use structured validation results (`code` and `details`) and the same lifecycle operations.
- A human and an automated coding agent can each revise an incomplete draft into a published workflow by following the guidance.
- Examples used by the guidance run as part of the shared validation suite from [E1-05](e1-05-build-workflow-example-validation-suite.md).
