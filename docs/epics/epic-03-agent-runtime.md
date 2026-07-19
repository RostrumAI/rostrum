# Epic-03: Agent and Model Runtime

Source PRD: [PRD-03](../prds/prd-03-agent-and-model-runtime.md)  
Status: Draft

## Outcome

Run controlled reasoning nodes with provider adapters, context provenance, structured outputs, tool boundaries, and usage records.

## Epics and tasks

### E-AGENT-01: Provider and model adapters

- [ ] Define provider-neutral request, response, tool-call, error, and usage contracts.
- [ ] Implement a mock provider for platform tests.
- [ ] Implement the first production model adapter.
- [ ] Add provider timeout, retry, fallback, and capability discovery.
- [ ] Record model/provider configuration and usage per call.

### E-AGENT-02: Context-view consumption

- [ ] Define the agent-side context-view input contract.
- [ ] Consume context views from the Context Layer without source-connector access.
- [ ] Add context size, sensitivity, freshness, and retention handling.
- [ ] Add provenance display and trace links for delivered context views.
- [ ] Add fresh-context behavior for workers and verifiers.

### E-AGENT-03: Structured reasoning nodes

- [ ] Implement schema-validated output node.
- [ ] Implement output repair/failure behavior.
- [ ] Implement role and instruction configuration.
- [ ] Implement bounded agent tool-call loop.
- [ ] Link model calls to node traces and artifacts.

### E-AGENT-04: Quality and safety

- [ ] Add prompt/context redaction.
- [ ] Add model allowlist and data handling policy.
- [ ] Create evaluation fixtures for planning and verification nodes.
- [ ] Add provider/model regression tests.

## SPIKEs

- [ ] S-AGENT-01 Provider-neutral message abstraction.
- [ ] S-AGENT-02 Context-view delivery and reproducibility without a central content cache.
- [ ] S-AGENT-03 Model quality gates beyond schema validation.
- [ ] S-AGENT-04 Prompt/version storage and privacy boundary.

## Exit criteria

Separate product, implementation, and verification nodes can consume distinct context views and model policies, and invalid outputs cannot advance the graph silently.
