# E1-03: Specify workflow JSON and its lifecycle

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-S1](e1-s1-define-workflow-interface-v1.md), [E1-S2](e1-s2-define-validation-behavior.md), [E1-S3](e1-s3-define-draft-publication-lifecycle.md) |

## Task

This task combines E1-S1, E1-S2, and E1-S3 into one public specification and fixture set. It answers:

- What does valid workflow JSON v1 contain?
- How do interface versions and step extensions work?
- What findings can validation return?
- What do draft, revision, and published-version records contain?
- Which examples demonstrate valid, incomplete, and invalid workflows?

It also creates the workflow JSON Schema.

## End state

- Authors and implementers can use one specification, schema, and example set to create and interpret workflow JSON.

## Why

- Workflow JSON, validation, and publication need one reviewed public contract.

## Blocks

- [E1-04: Implement the workflow library and validator](e1-04-implement-workflow-library-and-validator.md)
- [E1-05: Create validation fixtures and expected findings](e1-05-build-workflow-example-validation-suite.md)

## Acceptance criteria

- The specification explains every v1 field in plain language.
- The specification covers inputs, steps, connections, branches, data references, terminal results, and interface versioning.
- The specification distinguishes draft revisions from published workflow versions.
- The JSON Schema represents the documented v1 structure and step-extension mechanism.
- Valid examples pass schema validation and invalid shape examples fail for the expected reason.
- The specification and schema use the decisions from E1-S1, E1-S2, and E1-S3 consistently.
