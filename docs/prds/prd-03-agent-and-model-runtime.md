# PRD-03: Agent and Model Runtime

Status: Draft  
Strategic context: [Platform Product Plan](../strategy/rostrum-end-to-end-product-plan.md#2-what-we-are-building-and-why)<br>
Primary epic: [Agent runtime epics](../epics/epic-03-agent-runtime.md)

Research input: [Prewalk-style model handoff notes](../research/prewalk-model-handoff-notes.md)

## Purpose

Provide reasoning nodes with controlled model selection, structured outputs, tool boundaries, and context-view consumption. Agents should be replaceable workers inside a workflow, not the source of workflow truth. The separate Context Layer owns source access and pass-through delivery.

## Users and use cases

- A workflow node turns declared structured inputs into a validated model output.
- An architecture node turns requirements into a design with risks and interfaces.
- An implementation node performs a bounded task in a fresh context.
- A verifier evaluates an artifact independently against a contract.
- An exploration model hands a grounded execution trajectory to a cheaper or faster executor model.
- An organization routes sensitive work to an approved model or deployment.
- A workflow switches providers after a transient provider failure.
- A user inspects which model, prompt contract, context sources, and tools produced an output.

## Goals

- Normalize multiple model and agent providers behind a stable node contract.
- Consume context views from the Context Layer rather than retrieving directly from external systems.
- Support fresh context boundaries and role-specific configuration.
- Support a first-class transfer node that moves a conversation/trajectory to another model or runtime while preserving grounded state rather than only a prose plan.
- Enforce structured output validation and bounded tool use.
- Record model usage, latency, provider, and relevant configuration for audit and cost.

## Non-goals

- Training or hosting a foundation model.
- Hiding the fact that model output is probabilistic.
- Allowing agents to bypass workflow and policy boundaries.

## Required features

### Must

- Model adapter interface with request, response, error, and usage contracts.
- Model and provider policy: allowed providers, models, regions, data handling, and budgets.
- Prompt/context composition from declared context views rather than arbitrary ambient access.
- Structured output schemas with validation and repair/failure behavior.
- Tool-call interface that routes every tool request through deterministic policy enforcement.
- Context window and token budget controls.
- Fresh context and role identity for independent worker/verifier nodes.
- Provider timeout, retry, fallback, and failure classification.
- Redaction and sensitivity handling for prompts, outputs, and logs.
- Trace links from model call to node execution, run, artifact, and policy.
- Provider-neutral transfer packet containing context references, retained/pruned turns, tool calls, structured task state, hypotheses, artifacts, and transfer metadata.
- Explicit transfer conditions such as first valid action, checklist checkpoint, budget threshold, test milestone, or workflow-defined transition.
- Configurable context pruning, summarization, artifact spilling, and sensitive-field removal.
- Receiving-model initialization that identifies completed work, remaining work, validation criteria, and authority boundaries.
- Transfer failure behavior: fallback model, source-model resume, approval wait, retry, or safe failure.

### Should

- Context-view adapters for repository, project-artifact, issue-history, and documentation inputs.
- Model capability matching by task type, latency, cost, and risk.
- Prompt and context versioning.
- Offline/mock provider for deterministic platform tests.
- Evaluation fixtures for node quality and structured-contract adherence.
- Human-readable context provenance showing why a source was included.
- Transfer-node evaluation fixtures comparing single-model, prose-plan, and trajectory-preserving strategies.

### Could

- Model routing based on observed quality and cost.
- Private model deployment adapters.
- Cross-run prompt and output comparison.
- Agent skill packages with signed dependencies.

## Acceptance criteria

1. A reasoning node cannot access tools or context not declared by its workflow and policy.
2. Invalid structured output cannot silently advance the graph.
3. A verifier can run with a fresh context and receive the original contract plus the produced artifact.
4. Provider failures are visible and handled by declared retry/fallback rules.
5. Usage is attributable to a run and node without exposing sensitive prompt content unnecessarily.
6. A configured transfer node preserves enough trajectory state for a receiving model to continue without silently expanding authority or losing completion criteria.

## Open questions and SPIKEs

- Provider-neutral message and tool-call abstraction.
- Prompt/version management and reproducibility level.
- How to distinguish model-generated content from deterministic evidence.
- Context-view delivery, retention, and privacy boundaries between the Context Layer and model provider.
- Quality gates for model nodes beyond schema validity.
- Provider APIs for preserving or reconstructing active context windows.
- Transfer condition reliability and premature-commitment failure modes.

## Ownership boundary

Adapter interfaces, local/mock providers, context-view contracts, trajectory/transfer contracts, and open-source model adapters belong in the open core. Hosted provider routing, managed model credentials, proprietary evaluation, and cloud cost optimization may be hosted features. Source connectors and pass-through retrieval are specified by PRD-14.
