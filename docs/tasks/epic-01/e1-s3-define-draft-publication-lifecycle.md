# E1-S3: Define the draft and publication lifecycle

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-S1](e1-s1-define-workflow-interface-v1.md) |

## Task

- Define workflow IDs, draft IDs, draft revisions, revision checks, published versions, stored JSON, and digests.
- Define how incomplete JSON is saved, retrieved, revised, and selected for publication.
- Define publication idempotency, immutable-version conflicts, and editing a draft after publication.
- Select how published JSON is normalized and hashed.

## Why

- Authors need to save incomplete work safely, while callers need to retrieve and verify the exact workflow Rostrum published.

## Blocks

- [E1-03: Write the workflow interface v1 specification](e1-03-write-workflow-interface-v1-specification.md)
- [E1-07: Add workflow draft and version storage](e1-07-add-workflow-draft-version-storage.md)

## Acceptance criteria

- A reviewed decision record defines each identifier and when it changes.
- Syntactically valid JSON can be saved as a draft despite blocking workflow findings.
- Each save creates a revision and uses a revision check to prevent silent overwrites.
- Publishing a selected valid revision creates an immutable version without removing the draft.
- Repeated publication and version conflicts have defined results.
- Shared test vectors reproduce the same published digest across intended implementations.

