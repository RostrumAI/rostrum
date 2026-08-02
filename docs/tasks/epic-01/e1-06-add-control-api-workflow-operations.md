# E1-06: Add Control API workflow operations

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-02](e1-02-build-control-api-foundation.md), [E1-04](e1-04-implement-workflow-library-and-validator.md), [E1-05](e1-05-build-workflow-example-validation-suite.md) |

## Task

- Add operations to validate workflow JSON without saving it.
- Add operations to create a draft, save a new draft revision, and retrieve saved revisions.
- Add operations to publish a selected valid revision and retrieve published versions.
- Use the shared workflow library for every validation and publication decision.

## Why

- Authors need to save and revise incomplete workflows through the same service that later publishes them.

## Blocks

- [E1-07: Add workflow draft and version storage](e1-07-add-workflow-draft-version-storage.md)
- [E1-08: Publish workflow authoring guidance](e1-08-publish-workflow-authoring-guidance.md)
- [E1-09: Add the end-to-end Epic demonstration](e1-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- Syntactically valid JSON can be saved as a draft despite blocking workflow findings.
- Every save creates a draft revision and returns its validation findings.
- Saving from an outdated revision fails with a documented conflict.
- Draft and revision retrieval return the saved JSON and validation result.
- Publishing reruns validation and rejects a selected revision with blocking findings.
- A successful publish returns the workflow ID, published version, interface version, and digest.
- The generated API contract and integration tests cover the complete lifecycle.

