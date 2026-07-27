# PRD-07: Control Plane API and Local Daemon

Status: Draft  
Strategic context: [High-Level Build Blueprint](../strategy/rostrum-high-level-build-blueprint.md#48-control-api-and-service-boundary)<br>
Primary epic: [Control plane epics](../epics/epic-07-control-plane.md)

## Purpose

Expose one authoritative API for defining, validating, simulating, publishing, starting, controlling, inspecting, and configuring Rostrum. The API is both the configuration/control contract and the observation contract. In local deployments this boundary is provided by or alongside the Rostrum daemon; in hosted deployments it is provided by the tenant-aware control plane.

## Users and use cases

- TUI, web, CLI, SDK, and integrations start and control runs.
- A user lists projects, workflows, runs, artifacts, approvals, and environments.
- A local developer connects clients to a local daemon.
- A hosted organization manages workspaces, users, policies, and credentials.
- An administrator connects context sources and defines read-only context policies.
- An external event is authenticated and mapped to a workflow input.
- A caller invokes a selected workflow version with schema-validated structured inputs.
- An operator drains or disables a runtime target.
- A CLI/SDK caller starts a run asynchronously, observes events, waits for approval or completion, controls the run, and retrieves artifacts.
- A team administrator assigns project approvers and configures acceptable approval groups for a workflow.

## Goals

- Keep clients thin and interchangeable.
- Define stable resource and command contracts.
- Support local offline use and remote multi-user use.
- Make authentication, authorization, and audit consistent across clients.
- Provide versioned API and event contracts.

## Required features

### Must

- Resources for organizations, teams, users, groups, projects, memberships, approver policies, workspaces, workflows, workflow packages, simulations, runs, nodes, tasks, decisions, approvals, artifacts, targets, policies, integrations, context sources, and context policies.
- Commands for validate, simulate, publish, start, wait, observe, pause, resume, cancel, retry, approve, reject, comment, and re-run.
- Query and subscription endpoints for run state and events.
- Asynchronous run start returning a durable run handle; wait semantics for approval/question/terminal transitions with timeout and machine-readable exit status.
- Invocation contracts that require an explicit workflow identifier/version and validated input payload; natural-language routing is an optional workflow or external service, not an implicit API behavior.
- Event cursors and streaming observation that can resume after disconnect.
- Approval requests with required scope, acceptable users/groups, expiry, identity, evidence, and immutable decision history.
- Idempotency, pagination, filtering, cursors, and optimistic concurrency.
- Local daemon lifecycle, configuration, health, and data directory management.
- Authentication and authorization hooks that work locally and remotely.
- API versioning and machine-readable error model.
- Webhook/event ingestion with signature verification and replay protection.
- Capability discovery so clients know what the connected deployment supports.
- Consistent CLI/SDK operations for workflow validation/simulation/publication, run lifecycle, event observation, waiting, approvals, controls, and artifact retrieval.

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

- Local daemon packaging, process supervision, and separation from execution containers.
- API style and contract tooling.
- Local authentication model versus hosted identity.
- Single-user local workspace versus local multi-user server.
- Approval group semantics, membership changes during a run, quorum/dual-control rules, and delegated approval.
- Which commands are safe to queue while disconnected.

## Ownership boundary

The API contract, local daemon, CLI, SDK, and self-hosted server should be open-source. Hosted tenancy, ingress, account management, managed identity, and managed control-plane operations are hosted capabilities. The public contract must not require the hosted service.
