# E1-05: Create validation fixtures and expected findings

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-19 |
| Picked up | Yes |
| Owner | Stephen |
| Blocked by | [E1-03](e1-03-write-workflow-interface-v1-specification.md), [E1-04](e1-04-implement-workflow-library-and-validator.md) |

## Task

This task turns the specification examples into shared test fixtures. The suite contains:

- Minimum, sequential, and branching valid workflows, plus the five [E1-S1](../../decisions/epic-01/e1-s1-workflow-interface-v1.md) representative examples (sequential, conditional branching, fan-out and fan-in, bounded loop, grouped conditional).
- Incomplete drafts covering missing required fields, unfinished connections, and unfinished branches.
- One focused invalid workflow for each validation rule, aligned with the eight-stage pipeline in [E1-S2](../../decisions/epic-01/e1-s2-validation-behavior.md) (shape, identity, graph, conditional, termination, data references, input/output compatibility).
- Supported and unsupported interface versions.
- Digest test vectors computed as SHA-256 hex over the RFC 8785 canonical form with metadata members (`name`, `description` in v1) removed, per [E1-S3](../../decisions/epic-01/e1-s3-draft-publication-lifecycle.md) as amended by [E1-S4](../../decisions/epic-01/e1-s4-interface-versioning-methodology.md).
- Expected findings (code, blocking, path, related locations, details, line and column) and normalized results, ordered by pointer then code.

## End state

- The workflow library and Control API can prove their behavior against the same input files and expected results.

## Why

- Workflow validation and publication need reusable evidence that they interpret the specification consistently.

## Blocks

- [E1-06: Expose workflow authoring through the Control API](e1-06-add-control-api-workflow-operations.md)
- [E1-08: Document workflow authoring for humans and agents](e1-08-publish-workflow-authoring-guidance.md)

## Acceptance criteria

- The suite includes minimum, sequential, and branching valid workflows and the five E1-S1 representative examples.
- Incomplete drafts cover missing required fields, unfinished connections, and unfinished branches.
- Every documented validation rule has a focused invalid workflow and expected finding, including the representative matrix: cycle, unreachable dependency (branch-then-join), missing branch target, nested loop, invalid loop bound, conditional missing dependency, unterminated path, conditional that ends the workflow, unknown step type, ref to unknown output, fan-out and fan-in, loop body cycle, plus duplicate-key rejection.
- Each expected finding asserts code, blocking, JSON Pointer, related locations, details, and — when fixtures are text-sourced — line and column from the source map.
- Supported and unsupported interface-version cases are present; unknown versions are blocking with no fallback.
- Digest vectors cover formatting, property-order, and metadata-only differences; metadata-only edits produce the same digest. Vectors are independently reproduced before they ship.
- The workflow library and API tests consume the same files and expected results.
