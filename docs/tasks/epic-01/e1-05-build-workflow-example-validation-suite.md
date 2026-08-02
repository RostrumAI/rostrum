# E1-05: Create validation fixtures and expected findings

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-03](e1-03-write-workflow-interface-v1-specification.md), [E1-04](e1-04-implement-workflow-library-and-validator.md) |

## Task

This task turns the specification examples into shared test fixtures. The suite contains:

- minimum, sequential, and branching valid workflows;
- incomplete drafts;
- one focused invalid workflow for each validation rule;
- supported and unsupported interface versions;
- digest test vectors;
- expected findings and normalized results.

## End state

- The workflow library and Control API can prove their behavior against the same input files and expected results.

## Why

- Workflow validation and publication need reusable evidence that they interpret the specification consistently.

## Blocks

- [E1-06: Expose workflow authoring through the Control API](e1-06-add-control-api-workflow-operations.md)
- [E1-08: Document workflow authoring for humans and agents](e1-08-publish-workflow-authoring-guidance.md)

## Acceptance criteria

- The suite includes minimum, sequential, and branching valid workflows.
- Incomplete drafts cover missing required fields, unfinished connections, and unfinished branches.
- Every documented validation rule has a focused invalid workflow and expected finding.
- Supported and unsupported interface-version cases are present.
- Digest vectors cover formatting and property-order differences selected by E1-S3.
- The workflow library and API tests consume the same files and expected results.
