# PRD-09: Web Control Panel and Mobile Approvals

Status: Draft  
Strategic context: [Platform Product Plan](../strategy/rostrum-end-to-end-product-plan.md#2-what-we-are-building-and-why)<br>
Delivery Epics: [Epic-08](../epics/epic-08-control-applications.md), [Epic-11](../epics/epic-11-collaborative-authoring.md)

## Purpose

Provide the primary browser-based workflow client for collaborative authoring, graph review, per-node simulation, project configuration, workflow history, artifact review, approvals, and fleet visibility. Its shared application code also powers the desktop client. Provide a responsive mobile-friendly experience for high-value monitoring and decisions without requiring a separate native mobile app initially.

## Users and use cases

- A product owner reviews requirements and architecture on a large screen.
- A security reviewer examines a threat model, dependency report, or deployment gate.
- A manager views many projects and blocked runs.
- An operator configures integrations, environments, policies, and credentials.
- A user receives a mobile approval request and makes a bounded decision.
- A user comments on an artifact and sends the workflow back for revision.
- A team inspects historical evidence and run costs.
- An explicitly enabled authoring experience asks a model to propose a workflow, inspects the rendered graph, simulates it, and publishes an approved version.

## Goals

- Make Rostrum’s durable project/run/artifact model understandable.
- Share the primary authoring and run-management experience with the desktop application.
- Give mobile users safe, concise, auditable control.
- Use the same API and event model across web and desktop.
- Make graph creation and simulation understandable to users who do not want to hand-author workflow JSON.

## Required features

### Must

- Authentication, organization/project/workspace navigation, and role-aware access.
- Project overview with goals, active runs, decisions, artifacts, blockers, and history.
- Workflow/version selection and run initiation.
- Visual workflow graph authoring for nodes, edges, contracts, loops, approvals, policies, and terminal conditions.
- Workflow JSON import/export, revision history, semantic comparison, comments, validation, review, and publication.
- Per-node simulation configuration, rich mock-data selection, path coverage, and suppressed-effect reporting.
- Optional model-generated workflow proposal review with assumptions, risks, and simulation evidence; ordinary workflow invocation still requires an explicit workflow and structured inputs.
- Plan, diff, report, log, and deployment artifact views.
- Review comments, questions, decisions, approval, rejection, and request-changes actions.
- Approval inbox with scope, evidence, risk, expiry, and identity.
- Run timeline and graph visualization suitable for large flows.
- Configuration for workspace, target, integration, and policy references.
- Responsive layouts for status, notifications, artifact review, and approvals.
- Audit visibility for decisions and side effects.

### Should

- Form-based workflow and policy authoring.
- Project templates and reference workflows.
- Cost, reliability, loop, and cycle-time analytics.
- Notifications and escalation preferences.
- Shareable read-only artifact/report links with explicit expiration.

### Could

- Native mobile wrapper.
- Collaborative cursors and presence indicators.

## Acceptance criteria

1. A reviewer can understand the product request, current plan, open questions, and required decision without reading the entire run trace.
2. Mobile approval includes enough context to make a safe bounded decision or clearly defers to the full web/desktop experience.
3. All decisions made in web/mobile are visible in the desktop client and event history.
4. Users cannot approve an action outside their authorization or after the request expires.
5. Configuration changes are versioned or auditable and do not silently alter in-flight runs.

## Open questions and SPIKEs

- Self-hosted packaging and local-daemon connection model for the web app.
- Artifact rendering and safe preview strategy.
- Notification delivery and offline behavior for mobile approvals.
- Collaboration model: comments, mentions, threaded decisions, and review ownership.
- How much administrative configuration belongs in the control application versus SDK or configuration files.

## Ownership boundary

The UI shell, revisioned collaboration model, visual workflow editor, simulator client, and core run/review experience should be open-source because the web control application is self-hostable. Hosted identity, notifications, managed retention, fleet analytics, and account administration may be hosted services.
