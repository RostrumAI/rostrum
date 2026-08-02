# E1-05: Build the workflow example and validation suite

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-03](e1-03-write-workflow-interface-v1-specification.md), [E1-04](e1-04-implement-workflow-library-and-validator.md) |

## Task

- Create shared valid, incomplete, and invalid workflows, interface-version cases, and digest test vectors.
- Make the suite reusable by the workflow library and Control API tests.

## Why

- Shared examples prove that draft validation, explicit validation, and publication interpret the workflow interface the same way.

## Blocks

- [E1-06: Add Control API workflow operations](e1-06-add-control-api-workflow-operations.md)
- [E1-08: Publish workflow authoring guidance](e1-08-publish-workflow-authoring-guidance.md)

## Acceptance criteria

- The suite includes minimum, sequential, and branching valid workflows.
- Incomplete drafts cover missing required fields, unfinished connections, and unfinished branches.
- Every documented validation rule has a focused invalid workflow and expected finding.
- Supported and unsupported interface-version cases are present.
- Digest vectors cover formatting and property-order differences selected by E1-S3.
- The workflow library and API tests consume the same files and expected results.

