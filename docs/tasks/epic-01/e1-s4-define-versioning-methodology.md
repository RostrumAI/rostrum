# E1-S4: Decide versioning methodology and runtime impact

| Tracking | Value |
| --- | --- |
| Status | Decided — approved |
| Last updated | 2026-08-19 |
| Picked up | Yes |
| Owner | Thomas |
| Blocked by | [E1-S1](e1-s1-define-workflow-interface-v1.md), [E1-S3](e1-s3-define-draft-publication-lifecycle.md) |

## Task

Decisions made so far are recorded in [Decision e1-s4: Interface versioning methodology and runtime impact](../../decisions/epic-01/e1-s4-interface-versioning-methodology.md).

This SPIKE decides when Rostrum's workflow interface version bumps and how version changes affect running workflows. It answers:

- What constitutes an operational change (affecting execution behavior) vs a metadata change (e.g., description, name)?
- Which change types trigger an interface version bump?
- How do actively running workflows get impacted when a new interface version is published?
- How do metadata-only changes interact with versions?
- How do popular workflow platforms (Zapier, Temporal, n8n, etc.) handle versioning methodology and runtime impact?

The current exact-match version token contract for v1 (`"v1"` string, exact match, no fallback) is not altered by this SPIKE. This SPIKE determines the methodology for future version transitions and the operational impact on running workflows.

## End state

- One decision record defines the versioning methodology and runtime impact rules.

## Why

- Authors, the validator, the Control API, and the daemon need to know when a version bump occurs and what happens to in-flight workflows when it does.

## Blocks

- [E1-03: Specify workflow JSON and its lifecycle](e1-03-write-workflow-interface-v1-specification.md)

## Acceptance criteria

- A reviewed decision record classifies operational vs metadata changes.
- The record defines which change types trigger an interface version bump.
- The record defines how actively running workflows are impacted by version changes.
- The record includes comparative research on how Zapier, Temporal, n8n, and similar platforms handle versioning methodology and runtime impact.
- The current v1 exact-match token contract is preserved.
