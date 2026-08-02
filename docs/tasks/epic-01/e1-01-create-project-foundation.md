# E1-01: Create the repository and quality foundation

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-S0](e1-s0-select-implementation-stack.md) |

## Task

This task creates the repository structure selected by E1-S0. It adds:

- reproducible dependency management;
- build, format, lint, and test commands;
- unit and integration test harnesses;
- continuous integration;
- initial packages or modules for shared workflow code and the Control API.

## End state

- A new contributor can set up, build, check, and test every initial package with documented commands.

## Why

- Every Epic 1 implementation task needs the same repository and quality conventions.

## Blocks

- [E1-02: Create the standalone Control API process](e1-02-build-control-api-foundation.md)
- [E1-04: Implement the workflow library and validator](e1-04-implement-workflow-library-and-validator.md)

## Acceptance criteria

- The selected repository structure is present and documented.
- Dependency versions are reproducible.
- Documented commands build, format, lint, and test every initial application and package.
- Unit and integration test harnesses can run locally.
- Continuous integration runs the same required checks.
- A new contributor can complete the documented setup without undocumented steps.
