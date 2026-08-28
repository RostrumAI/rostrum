# E2-S3: Reference step selection

| Tracking | Value |
| --- | --- |
| Status | Closed, absorbed by E2-06 |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | None |

## Outcome

Epic 02 no longer needs a separate SPIKE to select reference steps. The E2-S1 decision defines the handler boundary and the execution behaviors the reference steps must prove. Selecting a small deterministic step set is a bounded implementation decision.

[E2-06: Build the step interface and reference steps](e2-06-build-step-interface-and-reference-steps.md) now owns:

- required and optional handler inputs;
- configuration and exact output schemas;
- explicit handler success and failure responses;
- the minimum deterministic, side-effect-free reference steps;
- test-only controlled handlers for reliable concurrency tests.

Keeping this closed record preserves existing links from earlier planning documents while making E2-06 the only active owner of the work.
