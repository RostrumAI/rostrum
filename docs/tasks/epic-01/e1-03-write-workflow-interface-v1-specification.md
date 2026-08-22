# E1-03: Specify workflow JSON and its lifecycle

| Tracking | Value |
| --- | --- |
| Status | Done — [specification](../../specs/workflow-interface-v1.md) awaiting approval |
| Last updated | 2026-08-20 |
| Picked up | Yes |
| Owner | Stephen |
| Blocked by | [E1-S1](e1-s1-define-workflow-interface-v1.md), [E1-S2](e1-s2-define-validation-behavior.md), [E1-S3](e1-s3-define-draft-publication-lifecycle.md), [E1-S4](e1-s4-define-versioning-methodology.md) |

## Task

This task combines [E1-S1](../../decisions/epic-01/e1-s1-workflow-interface-v1.md), [E1-S2](../../decisions/epic-01/e1-s2-validation-behavior.md), [E1-S3](../../decisions/epic-01/e1-s3-draft-publication-lifecycle.md), and [E1-S4](../../decisions/epic-01/e1-s4-interface-versioning-methodology.md) into one public specification, JSON Schema, and fixture set. It answers:

- What does valid workflow JSON v1 contain — top-level fields (`interfaceVersion`, `id`, `name`, `description`, `firstNode`, `inputs`, `steps`, `conditionals`), step fields (`id`, `type`, `config`, `inputs`, `outputs`, `successors`, `dependencies`, `conditional`, `loop`), DAG topology, data references, conditional shape, loop shape, and UUID v7 identifiers?
- How do interface versions and step-type extensions work — exact-match `interfaceVersion` selection, registry lookup, additive vs breaking evolution, and retention of the frozen v1 rule set?
- What do draft, revision, and published-version records contain — server-assigned workflow `id`, per-save revision `id` (UUID v7), per-workflow integer version number, and digest?
- When does each identifier change — draft creation, every successful save, rewind, and publish?
- How are conditionals, loops, and terminal results defined — conditional as a separate top-level shape with `branches` (label, priority, condition, `next`), `default`, and `all`/`any` composition; bounded `forEach` loops with `collection`, `maxIterations`, `variable`, and `body`; terminal `result` steps and end-workflow branch omissions?
- What findings can validation return — the eight-stage pipeline, prerequisite gating, finding shape, and v1 input/output compatibility limits defined by E1-S2?
- Which field changes trigger an interface version bump and how do version changes affect running workflows — field-classification table (`name` and `description` are metadata in v1), breaking-only bumps, bind-on-start, and deprecation windows defined by E1-S4?
- How is published JSON normalized and hashed — RFC 8785 canonical form with metadata members removed and SHA-256 hex digest?
- Which examples demonstrate valid, incomplete, and invalid workflows?

It also creates the workflow JSON Schema (JSON Schema 2020-12 via TypeBox).

## End state

- Authors and implementers can use one specification, schema, and example set to create and interpret workflow JSON across the shape, validation, lifecycle, and versioning decisions.

## Why

- Workflow JSON, validation, and publication need one reviewed public contract that reflects every SPIKE decision.

## Blocks

- [E1-04: Implement the workflow library and validator](e1-04-implement-workflow-library-and-validator.md)
- [E1-05: Create validation fixtures and expected findings](e1-05-build-workflow-example-validation-suite.md)

## Acceptance criteria

- The specification explains every v1 field in plain language, including DAG topology (acyclic, forward edges, dependency reachability, fan-out parallelism, fan-in via dependencies, terminal steps, path endings), data-reference paths (`inputs.<name>`, `step.<id>.<output>`, `loop.<variable>`), conditional shape and condition expressions, and loop rules (acyclic body, no nesting in v1, bounded `forEach` only, `maxIterations >= 1`).
- The specification includes the field-classification table for E1-S4: every v1 field classified as identity (`id`), metadata (`name`, `description`), version selector (`interfaceVersion`), or operational; step internals are operational.
- The specification states breaking vs additive evolution: a change that makes a previously valid document invalid (including `config` schema invalidation, type removal, semantic reinterpretation, or digest-contract change) requires a new interface version; additive changes (new optional field, new step type, relaxed validation, new operator) stay within `v1`.
- The specification states runtime behavior: bind-on-start (a run executes the exact published version it started against), no in-flight auto-upgrade in v1, and deprecation windows where new invocations are refused at end of life while in-flight runs continue.
- The specification distinguishes draft revisions from published workflow versions, including save eligibility (syntactically valid JSON saves despite blocking findings; parse failures are errors), `baseRevision` optimistic check, atomic revision insert, publication of the current revision with re-validation, idempotent repeat publish, rewind semantics, and draft-after-publication.
- The digest section specifies RFC 8785 canonicalization, SHA-256 lowercase hex, metadata exclusion (`name`, `description` removed before canonicalization), duplicate-key rejection, and reproducibility from the document alone.
- The JSON Schema represents the documented v1 structure and step-extension mechanism and uses JSON Schema 2020-12.
- Valid examples pass schema validation and invalid shape examples fail for the expected reason.
- The specification and schema use the decisions from E1-S1, E1-S2, E1-S3, and E1-S4 consistently, including the E1-S3 digest amendment from E1-S4.
