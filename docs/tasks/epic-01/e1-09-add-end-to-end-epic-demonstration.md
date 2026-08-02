# E1-09: Add the end-to-end Epic demonstration

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-06](e1-06-add-control-api-workflow-operations.md), [E1-07](e1-07-add-workflow-draft-version-storage.md), [E1-08](e1-08-publish-workflow-authoring-guidance.md) |

## Task

- Create one repeatable demonstration of the complete Epic 01 product state.
- Exercise incomplete draft storage, validation findings, revision, revision conflicts, publication, Control API restart, retrieval, and digest verification.
- Run the demonstration as a release gate in continuous integration.

## Why

- The Epic needs one proof that authors can move from incomplete work to an immutable published workflow through the documented Control API.

## Blocks

- Epic 02: Local workflow execution

## Acceptance criteria

- The demonstration saves and retrieves an incomplete draft with the expected findings.
- An outdated revision save fails without overwriting newer work.
- A corrected revision validates and publishes successfully.
- The draft and published workflow remain retrievable after the Control API restarts.
- Editing the draft after publication leaves the published version unchanged.
- The retrieved published JSON produces the stored digest using the documented rules.
- The demonstration runs from one documented command and passes in continuous integration.

