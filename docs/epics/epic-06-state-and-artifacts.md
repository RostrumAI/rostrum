# Epic-06: State, Events, Artifacts, and Observability

Source PRD: [PRD-06](../prds/prd-06-state-events-artifacts-observability.md)  
Status: Draft

## Outcome

Create the durable evidence layer that lets Rostrum recover, observe, explain, and review workflow execution.

## Epics and tasks

### E-STATE-01: Event and identity contracts

- [ ] Define event envelope, schema version, sequence, cursor, and correlation fields.
- [ ] Define run/node/tool/artifact/decision/deployment identifiers.
- [ ] Implement event validation and compatibility checks.
- [ ] Add snapshot plus replay semantics.

### E-STATE-02: Persistence and subscriptions

- [ ] Implement local run/state persistence.
- [ ] Implement append/replay/query event store.
- [ ] Implement live subscriptions with reconnect cursors.
- [ ] Add event retention and compaction.
- [ ] Add failure/dead-letter handling.

### E-STATE-03: Artifact registry

- [ ] Define artifact type, provenance, sensitivity, and retention metadata.
- [ ] Implement content-addressed or integrity-checked storage.
- [ ] Add plan, diff, log, report, test, build, and deployment artifact types.
- [ ] Add artifact access control and redaction.
- [ ] Add artifact preview/export and run report generation.
- [ ] Ensure external context bodies are metadata-only by default and opt-in snapshots are explicit.

### E-STATE-04: Operational telemetry

- [ ] Add structured logs, metrics, traces, usage, and policy telemetry.
- [ ] Add basic run cost/latency/attempt summaries.
- [ ] Add operator diagnostics for stuck, expensive, or failing runs.
- [ ] Add audit export.

## SPIKEs

- [ ] S-STATE-01 Event-store and relational-state architecture.
- [ ] S-STATE-02 Large artifact storage and transport.
- [ ] S-STATE-03 Redaction timing and sensitive-data retention.
- [ ] S-STATE-04 OpenTelemetry integration and trace cardinality.
- [ ] S-STATE-05 Context provenance, hashes, and retention metadata without source-body persistence.

## Exit criteria

A client can disconnect and reconstruct a run, and a completed workflow produces a human-readable report linking its decisions, node executions, artifacts, evidence, and outcome.
