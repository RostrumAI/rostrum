# E1-S2: Decide validation checks and findings

| Tracking | Value |
| --- | --- |
| Status | Decided — approved |
| Last updated | 2026-08-19 |
| Picked up | Yes |
| Owner | Thomas |
| Blocked by | None |

## Task

Decisions made so far are recorded in [Decision e1-s2: Validation checks, finding shape, and execution order](../../decisions/epic-01/e1-s2-validation-behavior.md).

This SPIKE defines the validation contract for workflow JSON v1. It specifies the checks Rostrum runs, their order and prerequisites, the findings each check returns, and whether a finding blocks publication.

The checks cover:

- Workflow document shape.
- Step identity and references.
- Graph cycles, dependency reachability, fan-out, and branch targets.
- Loop bounds, loop-body cycles, and nested loops.
- Conditional branches, defaults, and condition dependencies.
- Valid terminal paths.
- Data-reference resolution and ordering.

The contract also states which input and output compatibility checks v1 performs before execution.

## End state

- A validation contract lists every v1 check in execution order, with its prerequisites, passing condition, and finding for a failed check.
- A test matrix contains one representative case for each rule.

## Why

- Draft saves, explicit validation, and publication need the same findings for the same workflow JSON.

## Blocks

- [E1-03: Specify workflow JSON and its lifecycle](e1-03-write-workflow-interface-v1-specification.md)

## Acceptance criteria

- The validation contract lists every v1 check in execution order.
- Each check states its prerequisites, passing condition, and failure finding.
- Each finding includes a stable code, publication impact, source location, related locations, and structured details.
- The test matrix includes one representative case for each rule.
- The contract states the supported limits of static input and output compatibility checks.
