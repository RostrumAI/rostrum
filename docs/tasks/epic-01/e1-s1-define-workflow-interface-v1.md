# E1-S1: Define workflow interface v1

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | None |

## Task

- Define the first workflow JSON shape, including its interface version, workflow and step IDs, inputs, steps, connections, branches, data references, and terminal results.
- Define how later step types add their fields and validation rules.
- Define how future Rostrum releases select rules by interface version and preserve v1 compatibility.

## Why

- The validator, Control API, and future daemon need one small workflow interface to implement against.

## Blocks

- [E1-S2: Define validation behavior](e1-s2-define-validation-behavior.md)
- [E1-S3: Define the draft and publication lifecycle](e1-s3-define-draft-publication-lifecycle.md)
- [E1-03: Write the workflow interface v1 specification](e1-03-write-workflow-interface-v1-specification.md)

## Acceptance criteria

- A specification outline covers sequential steps, branches, and terminal results.
- The interface-version and step-extension rules are explicit.
- Representative valid, incomplete, and invalid workflows demonstrate the proposed shape.
- The proposal explains how a future release can continue to recognize v1.
- The product owner and implementing engineer approve the decision.

