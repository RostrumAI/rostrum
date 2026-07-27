# PRD-08: Desktop Control Application

Status: Draft  
Strategic context: [High-Level Build Blueprint](../strategy/rostrum-high-level-build-blueprint.md#49-control-clients)<br>
Delivery Epic: [Epic-08](../epics/epic-08-control-applications.md)

## Purpose

Provide an installable desktop control application for local and remote Rostrum deployments. The initial implementation should reuse the web control application's UI and Control API client through Electron or an equivalent desktop-capable web shell rather than creating a separate terminal interface.

## Users and use cases

- A developer connects the app to a local daemon and opens a workflow JSON from disk.
- A workflow author creates, validates, simulates, reviews, and publishes workflows.
- A user watches local or remote runs without keeping a terminal process open.
- An engineer inspects graph state, node traces, diffs, logs, test results, and artifacts.
- A reviewer comments on a revision and approves or rejects a gated decision.
- An operator pauses, resumes, retries, or cancels a run.
- A user switches between local, self-hosted, and Rostrum Cloud connection profiles.

## Goals

- Share workflow and run experiences with the web application.
- Provide first-class local-daemon discovery and filesystem integration.
- Keep all authoritative workflow and run state behind the Control API.
- Support desktop notifications, deep links, and safe external-tool handoffs.
- Avoid maintaining a second graph renderer or control model.

## Non-goals

- Owning workflow state or executing models, scripts, or tools directly.
- Creating a desktop-only workflow format.
- Providing a terminal user interface in the initial product.
- Replacing the responsive web experience for mobile decisions.

## Required features

### Must

- Shared web/desktop views for workflow authoring, revision review, simulation, runs, artifacts, and approvals.
- Local daemon discovery, launch/status handoff, and connection recovery.
- Local and remote connection profiles with clear environment identity.
- Import/export and drag-and-drop opening of workflow JSON.
- Safe file, diff, artifact, and external-editor handoffs.
- Live event reconnection and durable state recovery.
- Desktop notifications and deep links for approvals, failures, and completed runs.
- Platform-appropriate credential storage and explicit trust prompts for local resources.
- Signed application builds and an update strategy.

### Should

- Protocol links that open a workflow, run, node, artifact, or approval.
- Multiple project windows.
- Local cache of non-sensitive presentation metadata with explicit invalidation.
- Offline workflow JSON editing and validation when the local validator is available.

### Could

- Native menu, tray, and global shortcut integrations.
- Extension points for local developer tools.

## Acceptance criteria

1. The same workflow version and run render consistently in web and desktop clients.
2. Closing the application does not pause or lose a run.
3. A user can connect to a local daemon without manually entering its transport details.
4. Local files and credentials are not exposed to a remote deployment without explicit action.
5. A deep link can open the exact workflow revision, run, artifact, or approval.

## Open questions and SPIKEs

- Electron, Tauri, installable PWA, or another desktop-capable web shell.
- Local-daemon discovery and process-lifecycle boundary.
- Code sharing, release, signing, and update architecture across desktop and web.
- Safe filesystem, external-editor, and protocol-link integration.

## Ownership boundary

The desktop application and shared client libraries should be open-source and use the public Control API. Hosted-only features may appear when connected to Rostrum Cloud, but the application must remain usable with a self-hosted daemon.
