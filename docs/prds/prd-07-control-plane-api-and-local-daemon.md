# PRD-07: Control Plane API and Local Daemon

Status: Draft  
Strategic context: [High-Level Build Blueprint](../strategy/rostrum-high-level-build-blueprint.md#47-control-api-and-service-boundary)  
Primary epic: [Control plane epics](../epics/epic-07-control-plane.md)

## Purpose

Expose one authoritative API for starting, controlling, inspecting, and configuring Rostrum. In local deployments this boundary is provided by a daemon or service; in hosted deployments it is provided by the tenant-aware control plane.

## Users and use cases

- TUI, web, CLI, SDK, and integrations start and control runs.
- A user lists projects, workflows, runs, artifacts, approvals, and environments.
- A local developer connects clients to a local daemon.
- A hosted organization manages workspaces, users, policies, and credentials.
- An administrator connects context sources and defines read-only context policies.
- An external event is authenticated and mapped to a workflow input.
- An operator drains or disables a runtime target.

## Goals

- Keep clients thin and interchangeable.
- Define stable resource and command contracts.
- Support local offline use and remote multi-user use.
- Make authentication, authorization, and audit consistent across clients.
- Provide versioned API and event contracts.

## Required features

### Must

- Resources for organizations, projects, workspaces, workflows, runs, nodes, tasks, decisions, artifacts, targets, policies, integrations, context sources, and context policies.
- Commands for start, pause, resume, cancel, retry, approve, reject, comment, and re-run.
- Query and subscription endpoints for run state and events.
- Idempotency, pagination, filtering, cursors, and optimistic concurrency.
- Local daemon lifecycle, configuration, health, and data directory management.
- Authentication and authorization hooks that work locally and remotely.
- API versioning and machine-readable error model.
- Webhook/event ingestion with signature verification and replay protection.
- Capability discovery so clients know what the connected deployment supports.

### Should

- SDKs for common languages.
- CLI generated from the API contract.
- Offline command queue for selected local actions.
- Administrative APIs for target draining and policy rollout.
- GraphQL or query aggregation only if REST/event APIs become insufficient.

### Could

- Multi-region endpoint routing.
- Federated control planes.
- Embedded workflow authoring APIs.

## Acceptance criteria

1. TUI and web can display and control the same run through the API.
2. Closing and restarting the local daemon does not erase active run state.
3. Repeated commands with the same idempotency key do not duplicate side effects.
4. Unauthorized users cannot discover or control runs outside their scope.
5. A webhook cannot be replayed or accepted without valid authentication.

## Open questions and SPIKEs

- Local daemon packaging and process supervision.
- API style and contract tooling.
- Local authentication model versus hosted identity.
- Single-user local workspace versus local multi-user server.
- Which commands are safe to queue while disconnected.

## Ownership boundary

The API contract, local daemon, CLI, and self-hosted server should be open-source. Hosted tenancy, ingress, account management, and managed control-plane operations are hosted capabilities.
