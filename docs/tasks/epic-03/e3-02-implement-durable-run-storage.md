# E3-02: Implement durable run storage

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E3-01](e3-01-specify-durable-execution-behavior.md) |

## Task

This task replaces process-local run records with the shared durable persistence contract. It stores:

- accepted invocation inputs and immutable workflow identity;
- the current run and graph projection;
- step attempts, outcomes, and terminal results;
- durable checkpoints and recovery information;
- ordered operator commands and their disposition;
- human-decision requests and submitted responses;
- the event records required by each committed transition.

It adds the required schemas, migrations, transaction operations, and shared persistence library used by the daemon and Control API.

## End state

- A committed run and its execution records remain readable after both processes stop and restart.

## Why

- Recovery, inspection, and durable control need one persistent source of truth instead of the Epic 02 in-memory record.

## Blocks

- [E3-03: Recover interrupted runs](e3-03-recover-interrupted-runs.md)
- [E3-04: Implement retries and operator controls](e3-04-implement-retries-and-operator-controls.md)
- [E3-05: Implement human-decision waits](e3-05-implement-human-decision-waits.md)
- [E3-06: Add run timelines and artifacts](e3-06-add-run-timelines-and-artifacts.md)

## Acceptance criteria

- Initial run state commits before invocation is acknowledged as durably accepted.
- State projection, attempt changes, and required events commit atomically.
- Each command and decision submission has a stable identity and idempotent append behavior.
- The daemon can write execution transitions while the Control API has read-only access to their projections.
- The Control API can append commands and decisions without updating execution state.
- Migrations create and upgrade the durable schema through documented commands.
- Restarted processes read records that match the pre-restart committed state.
