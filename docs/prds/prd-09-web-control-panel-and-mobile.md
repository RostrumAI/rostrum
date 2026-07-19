# PRD-09: Web Control Panel and Mobile Approvals

Status: Draft  
Strategic context: [End-to-End Product Plan](../strategy/rostrum-end-to-end-product-plan.md#6-human-collaboration)  
Primary epic: [Client surface epics](../epics/epic-08-clients.md)

## Purpose

Provide the browser-based control and review surface for project configuration, workflow history, artifact review, approvals, and fleet visibility. Provide a responsive mobile-friendly experience for high-value monitoring and decisions without requiring a separate native app initially.

## Users and use cases

- A product owner reviews requirements and architecture on a large screen.
- A security reviewer examines a threat model, dependency report, or deployment gate.
- A manager views many projects and blocked runs.
- An operator configures integrations, environments, policies, and credentials.
- A user receives a mobile approval request and makes a bounded decision.
- A user comments on an artifact and sends the workflow back for revision.
- A team inspects historical evidence and run costs.

## Goals

- Make Rostrum’s durable project/run/artifact model understandable.
- Support richer review and configuration than the TUI.
- Give mobile users safe, concise, auditable control.
- Use the same API and event model as the TUI.

## Required features

### Must

- Authentication, organization/project/workspace navigation, and role-aware access.
- Project overview with goals, active runs, decisions, artifacts, blockers, and history.
- Workflow/version selection and run initiation.
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
- Collaborative cursors and real-time comments.
- Visual workflow editor.

## Acceptance criteria

1. A reviewer can understand the product request, current plan, open questions, and required decision without reading the entire run trace.
2. Mobile approval includes enough context to make a safe bounded decision or clearly defers to the full web/TUI experience.
3. All decisions made in web/mobile are visible in the TUI and event history.
4. Users cannot approve an action outside their authorization or after the request expires.
5. Configuration changes are versioned or auditable and do not silently alter in-flight runs.

## Open questions and SPIKEs

- Whether the first web app is open-source/self-hostable or initially cloud-only.
- Artifact rendering and safe preview strategy.
- Notification delivery and offline behavior for mobile approvals.
- Collaboration model: comments, mentions, threaded decisions, and review ownership.
- How much administrative configuration belongs in web versus CLI/TUI.

## Ownership boundary

The UI shell and core run/review experience should be open-source if self-hosting is a goal. Hosted identity, notifications, fleet analytics, premium collaboration, and managed account administration may be hosted services.

