# Rostrum PRDs

These first-draft PRDs translate the [High-Level Build Blueprint](../strategy/rostrum-high-level-build-blueprint.md) and [End-to-End Product Plan](../strategy/rostrum-end-to-end-product-plan.md) into concrete users, use cases, features, constraints, and acceptance criteria. They are intentionally broad enough to support architecture discussion and intentionally incomplete where a SPIKE is needed.

## PRD index

- [PRD-01: Workflow definition](prd-01-workflow-definition.md)
- [PRD-02: Durable orchestration runtime](prd-02-durable-orchestration-runtime.md)
- [PRD-03: Agent and model runtime](prd-03-agent-and-model-runtime.md)
- [PRD-04: Deterministic tools and policy gates](prd-04-deterministic-tools-and-policy.md)
- [PRD-05: Execution targets and sandboxing](prd-05-execution-targets-and-sandboxing.md)
- [PRD-06: State, events, artifacts, and observability](prd-06-state-events-artifacts-observability.md)
- [PRD-07: Control plane API and local daemon](prd-07-control-plane-api-and-local-daemon.md)
- [PRD-08: TUI console](prd-08-tui-console.md)
- [PRD-09: Web control panel and mobile approvals](prd-09-web-control-panel-and-mobile.md)
- [PRD-10: Triggers and integrations](prd-10-triggers-and-integrations.md)
- [PRD-11: Software delivery workflow pack](prd-11-software-delivery-workflows.md)
- [PRD-12: Hosted governance, identity, and usage](prd-12-hosted-governance-identity-and-usage.md)
- [PRD-13: Deployment, release, and live validation](prd-13-deployment-release-and-live-validation.md)
- [PRD-14: Context layer](prd-14-context-layer.md)

## Reading order

Read PRDs 01-07 and PRD-14 for the execution platform and Context Layer, PRDs 08-10 for clients and external control, PRD-11 for the first domain-specific experience, PRD-13 for the deployment/release final mile, and PRD-12 for the hosted service boundary.

Keep architecture uncertainty visible. If a PRD depends on an unresolved technical choice, link to a SPIKE under `docs/epics/` rather than silently choosing an implementation. Requirement priorities use Must, Should, and Could as a first-pass guide, not as a final commitment.
