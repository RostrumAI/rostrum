# PRD-05: Execution Targets and Sandboxing

Status: Draft  
Strategic context: [High-Level Build Blueprint](../strategy/rostrum-high-level-build-blueprint.md#45-execution-target-and-sandbox-layer)  
Primary epic: [Execution target epics](../epics/epic-05-execution-targets.md)

## Purpose

Provide isolated, reproducible environments in which agent and deterministic nodes can work. A workflow should select an execution target based on trust, sensitivity, cost, speed, hardware, and deployment environment.

## Users and use cases

- A developer prototypes a workflow in a local Docker workspace separate from the host repository.
- A team runs repeatable tests inside local Docker.
- A hosted run executes untrusted generated code in a microVM.
- A cloud workflow runs untrusted code in a microVM with the required resources.
- An operator configures environment images, mounts, caches, and network access.
- A workflow promotes the same artifact from local validation to staging and production with stronger policy at each boundary.

## Goals

- Define one target lifecycle contract across local and hosted implementations.
- Keep the control plane separate from untrusted code execution.
- Make workspace, image, mounts, network, credentials, and resource limits explicit.
- Capture enough metadata to reproduce or investigate an execution.
- Support cleanup, expiration, and artifact collection even after failure.

## Non-goals

- Choosing a single sandbox technology for every deployment class.
- Providing production Kubernetes operations in the local runtime.
- Treating a user’s host repository as an execution workspace.

## Target tiers

| Target | Intended use | Isolation posture |
| --- | --- | --- |
| Local/self-hosted Docker | Reproducible trusted or controlled workflows | Process/filesystem isolation |
| Rostrum Cloud microVM | Untrusted multi-tenant code | Dedicated kernel boundary |

## Required features

### Must

- Target adapter interface: provision, ready, execute, collect, pause/cancel, cleanup, inspect.
- Workspace and source snapshot binding.
- Per-run branch creation and push-to-origin change handoff without sharing the host repository.
- Immutable or pinned environment image/configuration for reproducible runs.
- Explicit mounts, environment variables, secrets, network, and capabilities.
- Resource limits and expiration.
- Artifact and log collection on success, failure, cancellation, and timeout.
- Health checks and target admission before work starts.
- Isolation classification visible to the workflow and user.
- Target selection based on policy and required capabilities.
- Cleanup guarantees and orphan detection.

### Should

- Warm pools or snapshots for faster startup.
- Workspace caching with integrity checks.
- Reproducibility metadata and environment diffing.
- Local-to-hosted target parity tests.
- Target draining and rolling maintenance controls.
- Image vulnerability scanning and provenance.

### Could

- Multi-architecture target routing.
- Hardware-backed confidential execution.
- Interactive remote debugging under an explicit approval policy.

## Acceptance criteria

1. A run cannot start in a target that lacks required isolation or capabilities.
2. A target is destroyed or safely reclaimed after its run ends.
3. A failed target still returns logs and artifacts when available.
4. A user can see where code ran, what it could access, and how long it lived.
5. A run can push its branch or commit to the configured origin without exposing the host repository as its execution workspace.
6. Local and hosted adapters conform to the same lifecycle and evidence contract.

## Open questions and SPIKEs

- Docker workspace lifecycle and source-snapshot strategy.
- Rostrum Cloud microVM provider and fleet boundary.
- Workspace snapshot and artifact transport model.
- Network isolation and live dependency testing design.
- How target lifecycle interacts with long-running development servers.

## Ownership boundary

Docker adapters and target contracts should be open-source. Rostrum Cloud microVM provisioning, fleet operations, managed images, and high-scale scheduling are hosted-service capabilities. Git branch creation, pushing, and change handoff are workflow/tool concerns, not sandbox targets.
