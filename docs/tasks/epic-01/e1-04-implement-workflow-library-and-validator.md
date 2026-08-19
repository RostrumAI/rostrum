# E1-04: Implement the workflow library and validator

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-19 |
| Picked up | Yes |
| Owner | Stephen |
| Blocked by | [E1-01](e1-01-create-project-foundation.md), [E1-03](e1-03-write-workflow-interface-v1-specification.md) |

## Task

This task creates the shared library that reads and validates workflow JSON. It performs these operations:

- Parse workflow JSON under the selected duplicate-key rule (duplicate keys are errors; `NaN`/`Infinity` and invalid UTF-8 are errors).
- Select validation rules from the declared `interfaceVersion` using exact match (`"v1"` in v1); unknown versions are blocking findings. Retain each interface version's rule set frozen so a new engine release never changes how a supported version validates.
- Run the eight-stage pipeline in order with prerequisite gating: 0 Parse, 1 Interface version, 2 Document shape (TypeBox `Schema.Compile`, JSON Schema 2020-12), 3 Identity and references, 4 Graph topology (acyclic, loop-body acyclic, no nested loops in v1, dependency reachability), 5 Conditional semantics, 6 Path and termination, 7 Data references, 8 Input and output compatibility (existence and ordering only in v1; type mismatch is advisory). A stage with a blocking finding gates its dependents.
- Return stable findings ordered by pointer then code. Each finding carries `code` (dot-namespaced, e.g. `workflow.graph.cycle`), `message`, `blocking`, `path` (JSON Pointer), `line`/`column` from the source map when text is available, `relatedLocations`, and structured `details`.
- Prepare a valid revision for publication using RFC 8785 canonicalization with metadata members (`name`, `description` in v1) removed before canonicalization, and SHA-256 lowercase hex digest.

The specification that defines shape, findings, identifiers, and versioning is [E1-03](e1-03-write-workflow-interface-v1-specification.md). The decisions that define validation order, finding shape, lifecycle identity, and versioning methodology are [E1-S2](../../decisions/epic-01/e1-s2-validation-behavior.md), [E1-S3](../../decisions/epic-01/e1-s3-draft-publication-lifecycle.md), and [E1-S4](../../decisions/epic-01/e1-s4-interface-versioning-methodology.md).

## End state

- The Control API and future daemon can use one library to read, validate, and prepare workflow JSON for publication with the same rules, ordering, and digests.

## Why

- Every workflow operation needs the same implementation of the public specification.

## Blocks

- [E1-05: Create validation fixtures and expected findings](e1-05-build-workflow-example-validation-suite.md)
- [E1-06: Expose workflow authoring through the Control API](e1-06-add-control-api-workflow-operations.md)

## Acceptance criteria

- The library reads workflow JSON and selects validation rules from its `interfaceVersion`; unknown versions are blocking and never fall back.
- Validation runs the eight stages in the required order and gates later stages when a prerequisite stage has a blocking finding.
- Shape validation uses TypeBox `Schema.Compile` and reports `workflow.shape.*` findings with schema paths in details; unknown fields and unknown step types are blocking.
- Findings use the codes, locations, `relatedLocations`, `details`, blocking decisions, and pointer-then-code ordering defined by E1-S2, including `line` and `column` when the source text is available.
- Publication preparation follows the digest contract: RFC 8785 canonical form, metadata members removed, SHA-256 hex. Metadata-only edits leave the digest unchanged and never require an interface version bump.
- The versioning rules follow E1-S4: each interface version's rule set is frozen, additive changes stay within the current version, breaking changes require a new interface version, and bind-on-start governs future execution.
- API-specific behavior stays outside the shared library.
- Unit tests cover every public operation and validation stage, including duplicate-key rejection and the representative fixture matrix.
