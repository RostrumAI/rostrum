# E2-S3: Select the reference steps for local execution

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-S1](e2-s1-define-local-execution-semantics.md) |

## Task

This SPIKE selects the minimum side-effect-free steps needed to prove local execution. It answers:

- Which steps can consume workflow inputs and earlier step outputs?
- Which steps can produce structured outputs that declared conditionals can evaluate?
- Which required-input, optional-input, output, configuration, and failure schemas does each step register?
- How does each handler return an explicit exact output object, including `{}` when it produces no values?

## End state

- The reference step schemas and examples can prove sequential data flow and branching without executing arbitrary code.

## Why

- The graph executor needs concrete handlers that can prove execution safely and deterministically.

## Blocks

- [E2-02: Specify executable workflow behavior and fixtures](e2-02-specify-executable-workflow-behavior.md)

## Acceptance criteria

- The selected set proves sequential and branching execution.
- Every step is deterministic, side-effect-free, and bounded.
- Schemas and examples define configuration, required and optional inputs, exact outputs, and failures.
- Every authored output declaration exactly matches the concrete registry output schema, and every handler result validates against it.
- The proposal explains why each step is necessary for the Epic demonstration.
