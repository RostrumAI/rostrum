# PRD-08: TUI Console

Status: Draft  
Strategic context: [High-Level Build Blueprint](../strategy/rostrum-high-level-build-blueprint.md#48-user-interfaces-and-clients)  
Primary epic: [Client surface epics](../epics/epic-08-clients.md)

## Purpose

Provide a fast, terminal-native mission-control console for local and remote Rostrum runs. The TUI is an observability and control client; it is not the workflow engine.

## Users and use cases

- A developer starts a workflow against a local repository.
- A user watches a remote run without keeping a process open locally.
- An engineer navigates parallel branches, node traces, diffs, logs, and test results.
- A reviewer inspects a plan and approves or rejects a gate.
- An operator pauses, resumes, retries, or aborts a run.
- A user disconnects and later reattaches without losing the run.
- A developer filters many runs by project, status, or blocker.

## Goals

- Make workflow state understandable at a glance.
- Expose evidence and blockers without forcing users into raw logs.
- Provide safe, explicit controls for high-impact commands.
- Work well for local development and remote observation.
- Remain usable over a constrained terminal connection.

## Non-goals

- Owning workflow state or executing models/tools directly.
- Replacing the web control plane for administration and configuration.
- Becoming a general-purpose chat client.

## Required features

### Must

- Run list and detail views.
- Graph/state view with current node, branches, loops, joins, and terminal status.
- Live event stream with reconnect and cursor recovery.
- Node detail: inputs/outputs subject to redaction, model/tool activity, status, timing, cost, and errors.
- Artifact inspection for plans, diffs, reports, logs, and deployment results.
- Approval and decision views with clear scope, risk, evidence, and expiry.
- Pause, resume, retry, cancel, abort, and re-run controls with confirmation.
- Search/filter/navigation optimized for keyboard use.
- Connection profile for local daemon and remote control plane.
- Read-only view and restricted-control operation.

### Should

- Watch multiple runs in a dashboard.
- Compare run versions and artifacts.
- Show budget/attempt progress and predicted exhaustion.
- Open files, diffs, or artifacts in the user’s configured tools.
- Export a run report.
- Support accessible color and text-only status indicators.

### Could

- TUI workflow authoring.
- Inline comments and collaborative review.
- Multiplexed multi-organization operator view.

## Acceptance criteria

1. A user can reattach to a remote run and see a consistent state.
2. The TUI never loses authoritative state when closed.
3. A user can identify what the workflow is waiting for within seconds.
4. A gated action shows the exact consequence, policy, evidence, and required identity.
5. A user can inspect a failed node and reach the relevant logs/artifacts without searching raw output manually.

## Open questions and SPIKEs

- TUI language/framework and portability target.
- Graph rendering strategy for large workflows.
- How to summarize agent traces without hiding important evidence.
- Terminal support for artifact previews and hyperlinks.
- Whether TUI can safely support local interactive tools.

## Ownership boundary

The TUI should be open-source and use the public control/event contracts. Hosted deployments may provide branded defaults or additional remote features without changing the client’s core behavior.
