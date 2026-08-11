# E3-10: Prove durable runs and human control end to end

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E3-08](e3-08-build-durable-execution-conformance-suite.md), [E3-09](e3-09-publish-durable-run-guidance.md) |

## Task

This task creates one repeatable proof of the complete Epic 3 product state. It:

- starts the Control API and daemon as separate processes;
- interrupts and restarts the daemon during an active attempt;
- verifies committed progress and the interrupted attempt after recovery;
- executes bounded retry success and exposes every attempt;
- waits across daemon and client interruption for a general human decision;
- retrieves the timeline by cursor and verifies a produced artifact;
- pauses and resumes active work at a recoverable point;
- cancels before a later step can begin;
- runs from one command in continuous integration.

## End state

- One release gate proves that a local run can survive, wait, be inspected, and be controlled through the real API and daemon boundary.

## Why

- The Epic needs one assembled proof that durability and control remain correct across real process interruptions.

## Blocks

- Epic 04: Docker tools and scripts

## Acceptance criteria

- The Control API remains able to inspect committed state while the daemon is stopped.
- A run interrupted during an active handler recovers and completes without losing committed progress.
- Retry success retains the documented failed and successful attempts.
- A decision wait survives daemon and client interruption and continues only after a valid response.
- Cursor replay returns the complete ordered timeline after reconnecting.
- A produced artifact passes identity, size, and digest verification.
- Pause interrupts active work at the documented safe point, and resume creates the documented attempt.
- Cancellation prevents the next step from starting.
- One documented command runs the demonstration in continuous integration.
