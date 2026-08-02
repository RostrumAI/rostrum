# E1-S0: Select the initial implementation stack

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | None |

## Task

- Compare suitable programming languages, frameworks, build tools, API tooling, persistence options, migration tools, and test frameworks.
- Define a repository structure for shared workflow code, the standalone Control API, and the separate daemon added in Epic 02.
- Prove the recommended structure with a thin implementation.

## Why

- Rostrum has no implementation foundation yet. This decision prevents the first production tasks from choosing incompatible tools or coupling the Control API to the daemon.

## Blocks

- [E1-01: Create the project foundation](e1-01-create-project-foundation.md)

## Acceptance criteria

- A reviewed decision record recommends the stack and repository structure.
- The decision covers builds, dependency management, API development, persistence, migrations, testing, and release boundaries.
- The Control API and future daemon are independently runnable applications that can share workflow code.
- A thin proof of concept demonstrates the key package and process boundaries.

