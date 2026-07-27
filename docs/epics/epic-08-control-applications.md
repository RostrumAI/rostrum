# Epic-08: Control Applications

Milestone: M8
Source PRDs: [PRD-08](../prds/prd-08-desktop-control-app.md), [PRD-09](../prds/prd-09-web-control-panel-and-mobile.md), [PRD-15](../prds/prd-15-workflow-authoring-and-simulation.md)
Status: Draft

## Outcome

One user can author, validate, simulate, publish, invoke, observe, and control workflows through a shared web application and Electron or equivalent desktop application.

## Tasks

### Shared client foundation

- [ ] Define workflow, simulation, run, event, artifact, approval, and error view models.
- [ ] Implement Control API client, event reconnect, redaction, role-aware presentation, and action confirmation.
- [ ] Share UI and graph-rendering libraries across web and desktop.

### Single-user authoring and operation

- [ ] Implement visual graph editing backed by workflow JSON.
- [ ] Show contracts, policies, capabilities, providers, context, budgets, simulation configuration, and validation errors.
- [ ] Implement validate, simulate, publish, invoke, timeline, graph-state, node-trace, artifact, and control views.
- [ ] Implement approval inbox and mobile-responsive decision views.

### Desktop application

- [ ] Package the shared application in Electron or an equivalent shell.
- [ ] Add local-daemon discovery, connection profiles, workflow JSON file handling, desktop notifications, and deep links.
- [ ] Define credential storage, filesystem trust, application signing, releases, and updates.

## SPIKEs

- [ ] Select the desktop shell and shared-code architecture.
- [ ] Select graph-editor and large-graph navigation libraries.
- [ ] Define safe artifact preview, filesystem handoff, and protocol links.

## Exit criteria

A single user visually creates and simulates a workflow, publishes and starts it, observes and controls its run from web or desktop, and completes a bounded approval from a mobile-sized browser.
