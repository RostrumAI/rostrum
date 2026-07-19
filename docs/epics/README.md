# Rostrum epics and SPIKEs

These first-draft implementation plans derive from the [PRD index](../prds/README.md). They are intentionally rough: task boundaries, dependencies, and SPIKEs are more important at this stage than estimates.

Use SPIKEs for questions that require investigation, prototypes, benchmarks, or architectural decisions before feature work can be estimated. A SPIKE should state:

- the decision or uncertainty;
- why it matters to Rostrum;
- the questions to answer;
- the proposed investigation or prototype;
- the evidence required;
- the decision and follow-up work.

## Epic index

- [Epic-00: Delivery roadmap and vertical slices](epic-00-delivery-roadmap.md)
- [Epic-01: Workflow definition](epic-01-workflow-definition.md)
- [Epic-02: Orchestration runtime](epic-02-orchestration-runtime.md)
- [Epic-03: Agent runtime](epic-03-agent-runtime.md)
- [Epic-04: Tools and policy](epic-04-tools-and-policy.md)
- [Epic-05: Execution targets](epic-05-execution-targets.md)
- [Epic-06: State and observability](epic-06-state-and-artifacts.md)
- [Epic-07: Control plane](epic-07-control-plane.md)
- [Epic-08: Clients](epic-08-clients.md)
- [Epic-09: Integrations](epic-09-integrations.md)
- [Epic-10: Software delivery](epic-10-software-delivery.md)
- [Epic-11: Hosted governance](epic-11-hosted-governance.md)
- [Epic-12: Cross-cutting quality](epic-12-cross-cutting-quality.md)
- [Epic-13: Deployment and live validation](epic-13-deployment-and-live-validation.md)
- [Epic-14: Context layer](epic-14-context-layer.md)

## Delivery sequence

The recommended first vertical slice is: workflow definition → context policy and pass-through source → local durable runtime → deterministic tools → Docker workspace → state/events → control API → TUI → planning/review/guided-build workflow. Hosted governance and fleet-scale execution follow after the local execution contract has been proven.

## Task convention

Tasks are written as implementation outcomes, not implementation instructions. A task can be decomposed later into Jira stories or tickets. SPIKEs are investigations or prototypes that should end in evidence and a decision.

Suggested initial areas mirror the PRDs:

- workflow definition and context layer;
- orchestration and durable state;
- deterministic tools and policy;
- execution targets;
- control API and clients;
- TUI and web surfaces;
- integrations;
- hosted governance and operations.
