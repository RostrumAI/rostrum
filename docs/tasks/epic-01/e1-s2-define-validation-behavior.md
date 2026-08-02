# E1-S2: Decide validation checks and findings

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-S1](e1-s1-define-workflow-interface-v1.md) |

## Task

This SPIKE decides how Rostrum reports problems in workflow JSON. It answers:

- Which checks run, and in what order?
- Which earlier checks must pass before a later check can run?
- Which document, step, connection, branch, and data-reference problems are detected?
- Which findings prevent publication?
- What code, location, related locations, and structured details does each finding contain?
- How much input/output compatibility can v1 check before execution?

## End state

- One validation contract and test matrix define every v1 check and its expected finding.

## Why

- Draft saves, explicit validation, and publication need the same findings for the same workflow JSON.

## Blocks

- [E1-03: Specify workflow JSON and its lifecycle](e1-03-write-workflow-interface-v1-specification.md)

## Acceptance criteria

- A validation contract lists every v1 check in execution order.
- Each check defines its prerequisites, passing condition, and finding when it fails.
- The finding shape covers stable codes, publication impact, source locations, related locations, and structured details.
- A test matrix includes one representative case for every rule.
- The contract states the supported limits of static input/output compatibility checks.
