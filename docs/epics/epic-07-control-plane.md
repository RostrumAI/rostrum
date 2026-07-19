# Epic-07: Control Plane API and Local Daemon

Source PRD: [PRD-07](../prds/prd-07-control-plane-api-and-local-daemon.md)  
Status: Draft

## Outcome

Provide one stable control and configuration boundary for all Rostrum clients and triggers.

## Epics and tasks

### E-API-01: Resource and command contract

- [ ] Define resource schemas and lifecycle for projects, workspaces, workflows, runs, tasks, decisions, artifacts, targets, policies, integrations, context sources, and context policies.
- [ ] Define start/control/approval/review command schemas.
- [ ] Define pagination, filtering, cursors, idempotency, and errors.
- [ ] Add API versioning and contract tests.

### E-API-02: Local daemon

- [ ] Implement daemon lifecycle, health, configuration, and data directory.
- [ ] Connect daemon to local runtime and target adapters.
- [ ] Support client discovery and connection profiles.
- [ ] Add local auth/permissions model.
- [ ] Add restart/recovery behavior.

### E-API-03: Remote control plane

- [ ] Implement authenticated remote API.
- [ ] Add event subscriptions and artifact access.
- [ ] Add webhook ingestion endpoint.
- [ ] Add context-source connection and context-policy management endpoints.
- [ ] Add capability discovery and feature flags.
- [ ] Add audit logging for control commands.

### E-API-04: SDK and CLI

- [ ] Generate or implement a typed SDK.
- [ ] Implement CLI commands for workflow/run/project/artifact/approval workflows.
- [ ] Add shell/CI-friendly output formats.
- [ ] Add API/CLI examples and local setup documentation.

## SPIKEs

- [ ] S-API-01 API style and contract toolchain.
- [ ] S-API-02 Local auth model and daemon packaging.
- [ ] S-API-03 Event subscription protocol.
- [ ] S-API-04 Safe offline command queue behavior.

## Exit criteria

The TUI and a CLI can start, observe, and control the same run through a local daemon, and the client contract remains usable against a remote deployment.
