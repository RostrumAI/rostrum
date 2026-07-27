# Epic-06: Project Context

Milestone: M6
Source PRDs: [PRD-14](../prds/prd-14-context-layer.md), [PRD-03](../prds/prd-03-model-provider-layer-and-runtime.md)
Status: Draft

## Outcome

Workflow nodes can receive read-only, policy-filtered project context without receiving source-system credentials or requiring Rostrum to retain source bodies by default.

## Tasks

### Context contracts

- [ ] Define context source, policy, selector, view, provenance, sensitivity, and retention contracts.
- [ ] Define node declarations for required sources, scopes, freshness, and size.
- [ ] Keep source retrieval separate from the Model Provider Layer.

### Pass-through broker

- [ ] Implement scoped credential use inside the broker.
- [ ] Fetch only selected source material, redact it, construct a bounded view, and release source bodies after delivery.
- [ ] Persist provenance, hashes, policy decisions, and operational metadata without source content by default.
- [ ] Implement repository/documentation and one collaboration-source connector.

### Policy and resilience

- [ ] Enforce project, workflow, node, field, time-range, and classification policy.
- [ ] Handle revocation, unavailable sources, stale data, partial retrieval, and prompt-injection markers.
- [ ] Add local mock connectors and source fixtures.

## SPIKEs

- [ ] Define pass-through delivery and reproducibility without a central cache.
- [ ] Define connector isolation and credential rotation.
- [ ] Define source-body opt-in retention and audit behavior.

## Exit criteria

A workflow consumes repository/documentation and collaboration context with redaction and provenance; the model node never receives connector credentials, and source bodies are absent from persisted run artifacts by default.
