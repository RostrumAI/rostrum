# Epic-05: Model Providers and Model Nodes

Milestone: M5
Source PRD: [PRD-03](../prds/prd-03-model-provider-layer-and-runtime.md)
Status: Draft

## Outcome

Workflows can execute structured model nodes through a provider-neutral layer with controlled credentials, capabilities, budgets, failures, and usage records.

## Tasks

### Model Provider Layer

- [ ] Define provider/model catalog, capability, region, data-handling, request, response, streaming, error, and usage contracts.
- [ ] Resolve scoped provider credential handles at runtime.
- [ ] Implement mock and first production provider adapters.
- [ ] Normalize timeout, retry, fallback, rate-limit, and usage behavior.

### Model nodes

- [ ] Compose declared instructions, inputs, and context slots into provider requests.
- [ ] Validate structured outputs and route repair or failure explicitly.
- [ ] Route tool requests through deterministic policy enforcement.
- [ ] Record provider, model, configuration, usage, latency, and trace provenance.

### Model execution strategies

- [ ] Support fresh worker and verifier contexts.
- [ ] Support workflow-declared changes in model/provider and bounded context pruning.
- [ ] Add evaluation fixtures for structured output, fallback, and trajectory-preserving continuation.

## SPIKEs

- [ ] Define the provider-neutral message and tool-call abstraction.
- [ ] Decide self-hosted provider adapter process placement and credential injection.
- [ ] Benchmark multi-model execution strategies against single-model baselines.

## Exit criteria

A workflow executes model nodes through mock and production adapters, validates their outputs, records usage, survives a declared provider failure, and cannot access undeclared tools or credentials.
