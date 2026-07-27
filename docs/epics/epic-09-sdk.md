# Epic-09: SDK

Milestone: M9
Source PRD: [PRD-07](../prds/prd-07-control-plane-api-and-local-daemon.md)
Status: Draft

## Outcome

Applications and internal platforms can invoke and control Rostrum through a typed, stable SDK rather than reimplementing Control API and event behavior.

## Tasks

### SDK contract

- [ ] Generate or implement typed resources, commands, events, errors, and pagination.
- [ ] Support explicit workflow/version selection and schema-validated invocation inputs.
- [ ] Return durable run handles and event cursors.

### Run lifecycle

- [ ] Implement asynchronous start, observe, wait, pause, resume, cancel, retry, and decision methods.
- [ ] Support waiting for approval, question, terminal result, or timeout.
- [ ] Implement artifact retrieval and structured final outcomes.
- [ ] Add idempotency, reconnect, retry, and cancellation helpers.

### Adoption and conformance

- [ ] Publish application, CI, and internal-platform examples.
- [ ] Test the SDK against local and remote Control API implementations.
- [ ] Define compatibility, versioning, and deprecation policy.

## SPIKEs

- [ ] Select the first SDK language and generation toolchain.
- [ ] Define streaming and asynchronous programming models.
- [ ] Define cross-language error and wait semantics.

## Exit criteria

A sample application invokes a selected workflow, reconnects to its events, waits through a human decision, retrieves artifacts, and receives the same structured outcome against local and remote endpoints.
