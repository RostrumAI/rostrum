# E3-S3: Define general human-decision waits

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [Epic 02](../../epics/epic-02-local-workflow-execution.md) |

## Task

This SPIKE defines a workflow step that waits durably for a general human decision. It answers:

- Which outcomes and optional response schema can a workflow declare?
- What information does the decision request expose to a person?
- When does the run enter and leave its decision wait?
- How does the selected outcome choose a connection and expose response data?
- What identifies a decision request and accepted response?
- What happens on duplicate, invalid, late, or conflicting submissions?
- What caller identity is recorded before approver policy exists?

## End state

- One reviewed decision-step contract and fixture set define durable requests, submissions, outcomes, and continuation.

## Why

- Rostrum needs one general human boundary that can represent approval, rejection, selection, correction, or structured input.

## Blocks

- [E3-01: Specify durable execution behavior and fixtures](e3-01-specify-durable-execution-behavior.md)

## Acceptance criteria

- The step declares named outcomes and an optional schema-validated response payload.
- Entering the wait commits the request without retaining an active handler.
- One accepted response selects a documented continuation and is available to downstream bindings.
- Duplicate, invalid, late, and conflicting submissions have stable results.
- Operator resume cannot answer or bypass a human-decision request.
- The contract records available caller identity without introducing users, groups, approver policy, or notifications.
