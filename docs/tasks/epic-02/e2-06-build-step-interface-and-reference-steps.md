# E2-06: Build the step interface and reference steps

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-03](e2-03-define-executable-workflow-contract.md), [E2-04](e2-04-make-workflow-interface-v1-executable.md) |

## Task

This task defines how the execution runtime invokes one workflow step. It adds:

- a registry of available step handlers, which are functions or components that execute the logic for specific step types;
- schemas for required inputs, optional inputs, configuration, and exact outputs;
- a single handler request containing only resolved inputs and declared configuration;
- `{ type: "success", outputs }` and `{ type: "failure", error }` response structures;
- runtime output validation and JSON-serializability checks;
- normalization of thrown errors, rejected promises, malformed responses, and explicit failures;
- a small set of reference steps, which are deterministic, side-effect-free step handlers used as baseline building blocks and test fixtures.

The reference steps must exercise workflow inputs, prior step outputs, empty and populated output objects, conditional values, loop items, and controlled failure. Test-only handlers can pause at controlled points so concurrency tests can inspect waiting and running work without relying on timing races.

## End state

The runtime can invoke one registered step with resolved inputs and receive either validated outputs or a safe structured failure.

## Why

Complete workflow execution requires a stable boundary between orchestration and step behavior. This boundary also supports side-effecting workers in later tasks without changing workflow control-flow rules.

## Blocks

- [E2-07: Execute sequential and conditional workflows](e2-07-execute-sequential-and-conditional-workflows.md)

## Acceptance criteria

- Every registered step type has configuration, required-input, optional-input, and exact-output schemas.
- The runtime passes required inputs and provided optional inputs without exposing mutable run state.
- Successful handlers always return an explicit output object; `{}` is valid for steps with no outputs.
- Missing, extra, incorrectly typed, or non-JSON outputs fail before commit.
- Thrown errors, rejected promises, malformed responses, and explicit handler failures become stable public failures without stack traces or arbitrary thrown values.
- Internal logs retain the original cause with run and step identifiers.
- Reference handlers return the documented result for every E2-03 fixture that uses them.
- Test-only controlled handlers are clearly separated from the reference step catalog.
