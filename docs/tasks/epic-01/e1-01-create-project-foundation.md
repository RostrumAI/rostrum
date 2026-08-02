# E1-01: Create the project foundation

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-S0](e1-s0-select-implementation-stack.md) |

## Task

- Create the repository structure selected by E1-S0.
- Add dependency management, formatting, linting, build commands, test harnesses, and continuous integration.
- Add initial applications or packages for shared workflow code and the standalone Control API.

## Why

- Every implementation task needs the same build, quality, and repository conventions.

## Blocks

- [E1-02: Build the Control API foundation](e1-02-build-control-api-foundation.md)
- [E1-04: Implement the workflow library and validator](e1-04-implement-workflow-library-and-validator.md)

## Acceptance criteria

- The selected repository structure is present and documented.
- Dependency versions are reproducible.
- Documented commands build, format, lint, and test every initial application and package.
- Unit and integration test harnesses can run locally.
- Continuous integration runs the same required checks.
- A new contributor can complete the documented setup without undocumented steps.

