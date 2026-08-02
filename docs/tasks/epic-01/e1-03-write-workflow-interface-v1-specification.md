# E1-03: Write the workflow interface v1 specification

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-S1](e1-s1-define-workflow-interface-v1.md), [E1-S2](e1-s2-define-validation-behavior.md), [E1-S3](e1-s3-define-draft-publication-lifecycle.md) |

## Task

- Write the public workflow interface v1 specification.
- Create its JSON Schema and representative examples.
- Document interface compatibility, step extensions, validation findings, and the draft and published workflow envelopes.

## Why

- Authors and implementers need one readable contract before validation and workflow lifecycle behavior become public.

## Blocks

- [E1-04: Implement the workflow library and validator](e1-04-implement-workflow-library-and-validator.md)
- [E1-05: Build the workflow example and validation suite](e1-05-build-workflow-example-validation-suite.md)

## Acceptance criteria

- The specification explains every v1 field in plain language.
- The specification covers inputs, steps, connections, branches, data references, terminal results, and interface versioning.
- The specification distinguishes draft revisions from published workflow versions.
- The JSON Schema represents the documented v1 structure and step-extension mechanism.
- Valid examples pass schema validation and invalid shape examples fail for the expected reason.
- The specification and schema use the decisions from E1-S1, E1-S2, and E1-S3 consistently.

