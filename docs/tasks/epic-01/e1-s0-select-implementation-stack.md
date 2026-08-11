# E1-S0: Select the implementation stack and workflow database

| Tracking | Value |
| --- | --- |
| Status | In progress |
| Last updated | 2026-08-10 |
| Picked up | Yes |
| Owner | Unassigned |
| Blocked by | None |

## Task

Decisions made so far are recorded in [Decision 0001: Implementation stack, Control API contract, and workflow persistence](../../decisions/0001-implementation-stack.md): Bun, Postgres, Hono, OpenAPI 3.1 generated from TypeBox schemas.

This SPIKE selects the technical foundation for Epic 1. It answers:

- Which language, framework, build tools, and test tools will Rostrum use?
- Which API tooling will define and test the Control API?
- Which database or equivalent persistent store will hold drafts, revisions, validation results, and published workflow versions?
- How will local development, schema migrations, transactions, and backup assumptions work?
- How will the Control API retrieve published workflows for future execution requests?
- How will shared workflow code, the Control API, and the future daemon be arranged in the repository?

The recommendation must be proven with a thin implementation.

## End state

- One approved stack, repository structure, process layout, and workflow persistence approach are ready for implementation.

## Why

- Epic 1 needs one compatible set of tools and boundaries before product code and durable workflow storage are created.

## Blocks

- [E1-01: Create the repository and quality foundation](e1-01-create-project-foundation.md)
- [E1-07: Persist workflow drafts and published versions](e1-07-add-workflow-draft-version-storage.md)

## Acceptance criteria

- A reviewed decision record recommends the stack, repository structure, and process layout.
- The decision selects a database or justified equivalent for workflow persistence.
- The persistence decision covers local development, schema migrations, transactions, backup assumptions, and published-workflow retrieval for future execution.
- The decision covers builds, dependency management, API development, testing, and release boundaries.
- The Control API and future daemon are independently runnable applications that can share workflow code.
- A thin proof of concept demonstrates the key package, process, and persistence boundaries.
