# E1-08: Document workflow authoring for humans and agents

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-05](e1-05-build-workflow-example-validation-suite.md), [E1-06](e1-06-add-control-api-workflow-operations.md) |

## Task

This task creates tested workflow-authoring instructions. They explain how to:

- create minimum, sequential, and branching workflow JSON;
- save and retrieve an incomplete draft;
- interpret structured validation findings;
- revise and publish a selected draft revision;
- retrieve and verify the published version.

The task also creates a first Rostrum authoring skill or equivalent instructions for automated coding agents.

## End state

- A human or automated author can turn an incomplete draft into a published workflow using only documented behavior and tested examples.

## Why

- Authors need instructions that exercise the same specification, API, and validation results implemented by Rostrum.

## Blocks

- [E1-09: Prove draft-to-publication behavior end to end](e1-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- The guidance explains the minimum, sequential, and branching workflow examples.
- The guidance shows how to save and retrieve an incomplete draft and interpret its findings.
- Every API behavior it uses is public and documented.
- The automated-author instructions use structured validation results.
- A human and an automated coding agent can each revise an incomplete draft into a published workflow by following the guidance.
- Examples used by the guidance run as part of the shared validation suite.
