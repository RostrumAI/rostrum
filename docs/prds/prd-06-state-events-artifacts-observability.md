# PRD-06: State, Events, Artifacts, and Observability

Status: Draft  
Strategic context: [Platform Product Plan](../strategy/rostrum-end-to-end-product-plan.md#2-what-we-are-building-and-why)<br>
Delivery Epic: [Epic-03](../epics/epic-03-durable-runs-and-human-control.md)

## Purpose

Make every run explainable, inspectable, and recoverable. Rostrum needs a durable record that connects workflow invocation and inputs, decisions, graph transitions, model calls and transfer nodes, tool/script execution, environments, artifacts, costs, and final outcomes.

## Users and use cases

- A user watches a live workflow from the web or desktop application.
- A reviewer inspects a plan, diff, test report, or deployment record.
- An operator investigates a failed or expensive run.
- A verifier consumes a prior artifact as a structured input.
- A compliance reviewer asks who approved a production change and what evidence existed.
- A client reconnects and reconstructs current state from a snapshot and event stream.
- A team searches historical runs by project, workflow, status, artifact, or failure.

## Goals

- Make run history durable and queryable.
- Stream updates without making clients the source of truth.
- Treat artifacts as first-class outputs with provenance and access control.
- Provide enough telemetry to operate local and hosted systems.
- Support retention, redaction, export, and deletion policies.

## Required features

### Must

- Canonical event envelope with event ID, run/node identity, sequence, timestamp, actor, type, payload, and schema version.
- Run snapshots plus replayable event history.
- Artifact registry with content identity, type, metadata, provenance, retention, and access policy.
- Links among invocation inputs, decision, node execution, transfer, tool/script call, artifact, and external side effect.
- Live subscriptions with reconnect and cursor semantics.
- Structured logs, metrics, traces, usage, and policy decisions.
- Redaction and sensitivity labels.
- Search and filtering for active and historical runs.
- Exportable run report suitable for review or audit.
- Retention and deletion behavior for logs, artifacts, model content, and opt-in context snapshots.
- Simulation-run events and explicit labels separating simulated state, artifacts, and evidence from production runs.

### Should

- Artifact diff and preview support for common software outputs.
- Cost and latency dashboards.
- Event schema compatibility tooling.
- Tamper-evident audit storage.
- OpenTelemetry-compatible traces.
- Data lineage from requirement to task to artifact to deployment.

### Could

- Semantic search over project/run history.
- Automatic incident summaries.
- Derived analytics on workflow quality and repair loops.

## Acceptance criteria

1. A reconnecting client can recover current state without missing material events.
2. Every artifact can be traced to the node, run, workflow version, and input context that produced it.
3. Sensitive values are not exposed in logs or artifacts outside policy.
4. A completed run can produce a human-readable evidence report.
5. Operators can identify the source of cost, latency, failure, and policy blockage.

## Open questions and SPIKEs

- Event-store versus relational state model.
- Event retention and replay cost.
- Artifact storage, content addressing, and large-output handling.
- Redaction before persistence versus access-time filtering.
- How much model/context-view content should be retained for reproducibility without violating pass-through guarantees.

## Ownership boundary

Local state, event, artifact, and observability implementations should be open-source. Hosted retention, cross-tenant analytics, managed audit, and operational dashboards may be hosted services.
