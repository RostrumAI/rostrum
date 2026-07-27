# Epic-10: Integrations

Milestone: M10
Source PRD: [PRD-10](../prds/prd-10-triggers-and-integrations.md)
Status: Draft

## Outcome

External systems can invoke explicit workflows and receive structured results through authenticated, durable, replay-safe integration contracts.

## Tasks

### Trigger and callback contracts

- [ ] Define normalized trigger envelope, source identity, workflow/version mapping, input binding, idempotency, and provenance.
- [ ] Implement signed webhook ingestion, replay protection, duplicate suppression, and dead-letter handling.
- [ ] Implement callbacks and status/result publication with retry and audit evidence.

### Integration adapters

- [ ] Build repository and CI fixture adapters.
- [ ] Build schedule and generic webhook triggers.
- [ ] Implement one production inbound connector and one outbound result adapter.
- [ ] Add notification and approval links for browser/desktop/mobile views.

### Testing and operations

- [ ] Provide mock external APIs and fixture payloads.
- [ ] Test rate limits, malformed payloads, revocation, partial failure, and retries.
- [ ] Expose integration health, last delivery, errors, and replay controls.

## SPIKEs

- [ ] Select the first production connector based on showcase needs.
- [ ] Define event ordering and idempotency across source retries.
- [ ] Define managed OAuth versus self-hosted credential setup.

## Exit criteria

An authenticated external event invokes the intended workflow exactly once, a failed delivery can be replayed safely, and the originating system receives a structured final outcome.
