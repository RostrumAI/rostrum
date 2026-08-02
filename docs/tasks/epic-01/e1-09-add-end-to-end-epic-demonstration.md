# E1-09: Prove draft-to-publication behavior end to end

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-06](e1-06-add-control-api-workflow-operations.md), [E1-07](e1-07-add-workflow-draft-version-storage.md), [E1-08](e1-08-publish-workflow-authoring-guidance.md) |

## Task

This task creates one repeatable proof of the complete Epic 1 product state. It:

- saves and retrieves an incomplete draft;
- revises the draft from validation findings;
- proves that a stale revision cannot overwrite newer work;
- publishes a valid selected revision;
- restarts the Control API;
- retrieves the unchanged draft and published version;
- reproduces the published digest;
- runs from one command in continuous integration.

## End state

- One release gate proves that workflow JSON can move from an incomplete draft to a durable, immutable published version.

## Why

- Individual tests need one end-to-end counterpart that proves the assembled product state.

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
