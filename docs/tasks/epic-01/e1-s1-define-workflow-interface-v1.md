# E1-S1: Decide the workflow JSON v1 shape

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-15 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | None |

## Task

This SPIKE decides what workflow JSON v1 contains. It answers:

- How does a workflow declare its interface version and identity?
- How are inputs, steps, connections, branches, data references, and terminal results represented?
- How does the step graph express fan-out (multiple successors), fan-in (dependencies), and bounded loops?
- How are conditionals defined as a separate shape — with branch rules (label, priority, condition), default fallback, and `all`/`any` condition composition?
- How do step types add configuration and validation rules?
- How does Rostrum select rules by interface version?
- How can future releases continue to recognize v1?

The primary authoring surface is a visual editor (to be built); the JSON shape is optimized for machine generation and parsing, not human readability. All identifiers are UUID v7.

## End state

- A specification outline and representative examples define the complete proposed v1 shape — including DAG topology (fan-out, fan-in, dependencies), conditionals as a separate shape, bounded loops, UUID v7 identifiers, and its evolution rules.

## Why

- The visual editor, automated authors, the validator, the Control API, and the future daemon need the same definition of a workflow.

## Blocks

- [E1-S2: Decide validation checks and findings](e1-s2-define-validation-behavior.md)
- [E1-S3: Decide how drafts become published versions](e1-s3-define-draft-publication-lifecycle.md)
- [E1-S4: Decide versioning methodology and runtime impact](e1-s4-define-versioning-methodology.md)
- [E1-03: Specify workflow JSON and its lifecycle](e1-03-write-workflow-interface-v1-specification.md)

## Acceptance criteria

- A specification outline covers sequential steps, fan-out, fan-in, dependencies, bounded loops, conditionals, and terminal results.
- The DAG topology rules are explicit: acyclic requirement, dependency reachability (merge-after-branch restriction), fan-out parallelism, and terminal step definition.
- The conditional shape is defined as a separate top-level concept with branch rules (label, priority, condition, next), default fallback, `all`/`any` condition composition, and leaf predicate operators.
- The loop shape is defined with `collection`, `maxIterations`, `variable`, and `body`, with stated limitations (no while/until, no nested loops, bounded collections only).
- All identifiers are UUID v7.
- The interface-version and step-extension rules are explicit.
- Representative valid workflows demonstrate sequential, conditional, fan-out/fan-in, loop, and grouped conditional logic, plus incomplete and invalid workflows.
- The proposal explains how a future release can continue to recognize v1.
- The product owner and implementing engineer approve the decision.
