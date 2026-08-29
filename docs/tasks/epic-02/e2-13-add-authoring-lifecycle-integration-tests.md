# E2-13: Add authoring lifecycle integration tests

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-29 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-06](../epic-01/e1-06-add-control-api-workflow-operations.md) |

## Task

This task creates integration tests for the complete workflow-authoring flow over HTTP: create a draft, save revisions against the current revision, receive conflicts with the current revision and its findings, rewind to an earlier revision, publish, and retrieve the published version with digest reproduction. The tests drive a real server process against a real database, not the in-process test harness the E1-06 unit tests use, so sockets, connection lifecycle, and error handling are under test.

The scope is the flow end to end, one test per documented behavior:

- draft creation replaces any author-supplied `id`;
- every save returns its findings and the retrievals return the stored bytes unchanged;
- a stale `baseRevision` fails with 409 and the current revision;
- rewind appends a copy and keeps every published version's source revision retrievable;
- publish re-validates, rejects blocking findings with 422, and answers with the version number, `interfaceVersion`, and digest;
- re-publishing the same revision is idempotent and the digest is reproducible from the retrieved canonical text.

## End state

Continuous integration exercises the complete draft-to-publication lifecycle through the real Control API surface, so a regression in storage outcomes, revision semantics, or error mapping fails the build even when every unit test passes.

## Why

E1-06 shipped focused handler tests against stubbed services and deleted the socket-free lifecycle suite during review, deferring whole-flow coverage to this task. Unit tests with stubs cannot observe optimistic-concurrency behavior, rewind copy semantics, or digest reproduction, because those are properties of the storage layer and the service working together.

## Blocks

- None.
