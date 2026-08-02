# E1-S2: Define validation behavior

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-S1](e1-s1-define-workflow-interface-v1.md) |

## Task

- Define the order and prerequisites of workflow validation checks.
- Define rules for document structure, steps, connections, branches, data references, unknown fields, and publication readiness.
- Define stable finding codes, blocking decisions, locations, related locations, and ordering.
- Determine how much input/output compatibility v1 can reliably check before execution.

## Why

- Draft saves, explicit validation, and publication must agree on the problems in a workflow and which problems prevent publication.

## Blocks

- [E1-03: Write the workflow interface v1 specification](e1-03-write-workflow-interface-v1-specification.md)

## Acceptance criteria

- A validation contract lists every v1 check in execution order.
- Each check defines its prerequisites, passing condition, and finding when it fails.
- The finding shape covers stable codes, publication impact, source locations, related locations, and structured details.
- A test matrix includes one representative case for every rule.
- The contract states the supported limits of static input/output compatibility checks.

