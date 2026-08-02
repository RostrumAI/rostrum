# E1-S1: Decide the workflow JSON v1 shape

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | None |

## Task

This SPIKE decides what workflow JSON v1 contains. It answers:

- How does a workflow declare its interface version and identity?
- How are inputs, steps, connections, branches, data references, and terminal results represented?
- How do step types add configuration and validation rules?
- How does Rostrum select rules by interface version?
- How can future releases continue to recognize v1?

## End state

- A specification outline and representative examples define the complete proposed v1 shape and its evolution rules.

## Why

- Authors, the validator, the Control API, and the future daemon need the same definition of a workflow.

## Blocks

- [E1-S2: Decide validation checks and findings](e1-s2-define-validation-behavior.md)
- [E1-S3: Decide how drafts become published versions](e1-s3-define-draft-publication-lifecycle.md)
- [E1-03: Specify workflow JSON and its lifecycle](e1-03-write-workflow-interface-v1-specification.md)

## Acceptance criteria

- A specification outline covers sequential steps, branches, and terminal results.
- The interface-version and step-extension rules are explicit.
- Representative valid, incomplete, and invalid workflows demonstrate the proposed shape.
- The proposal explains how a future release can continue to recognize v1.
- The product owner and implementing engineer approve the decision.
