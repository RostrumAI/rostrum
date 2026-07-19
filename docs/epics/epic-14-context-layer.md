# Epic-14: Context Layer

Source PRD: [PRD-14](../prds/prd-14-context-layer.md)  
Status: Draft

## Outcome

Give agents controlled, read-only access to project context through a pass-through broker that does not persist source content by default.

## Epics and tasks

### E-CONTEXT-01: Context contracts

- [ ] Define context source, selector, requirement, policy, view, bundle, and provenance schemas.
- [ ] Define connector capabilities and read-only contract.
- [ ] Define content sensitivity, untrusted-content, freshness, and retention metadata.
- [ ] Define metadata-only audit event contract.
- [ ] Add workflow/node context requirement examples.

### E-CONTEXT-02: Pass-through broker

- [ ] Implement source connection registry and credential references.
- [ ] Implement policy evaluation before retrieval.
- [ ] Implement just-in-time fetch and streaming/ephemeral delivery.
- [ ] Implement filtering, redaction, classification, size, and freshness limits.
- [ ] Ensure source bodies are not persisted by default.
- [ ] Add explicit opt-in context snapshot storage with retention controls.

### E-CONTEXT-03: Source connectors

- [ ] Implement repository and project-artifact context connector.
- [ ] Implement issue/project-tracker connector.
- [ ] Prototype Slack connector.
- [ ] Prototype Discord connector.
- [ ] Prototype documentation-site connector.
- [ ] Define incident/observability connector extension point.

### E-CONTEXT-04: Agent delivery and safety

- [ ] Deliver context views into local Docker and Rostrum Cloud microVM runs.
- [ ] Prevent agent access to connector credentials and source APIs.
- [ ] Label retrieved content as external/untrusted and preserve provenance.
- [ ] Add prompt-injection and source-content abuse tests.
- [ ] Add connector revocation, expiry, and health handling.

## SPIKEs

- [ ] S-CONTEXT-01 Pass-through streaming across process/container boundaries.
- [ ] S-CONTEXT-02 Redaction and sensitive-content classification.
- [ ] S-CONTEXT-03 Whole-project selector safety model.
- [ ] S-CONTEXT-04 Cursor-based retrieval without a central content cache.
- [ ] S-CONTEXT-05 Safe metadata retention and reproducibility.
- [ ] S-CONTEXT-06 Model-provider retention and training-policy disclosure.

## Exit criteria

A workflow can retrieve approved context from one external source into an isolated Docker run, prove that the source credential never reaches the agent, and show metadata/provenance without storing the source body by default.

