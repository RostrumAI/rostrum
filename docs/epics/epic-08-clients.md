# Epic-08: TUI, Web, and Mobile-Friendly Clients

Source PRDs: [PRD-08](../prds/prd-08-tui-console.md), [PRD-09](../prds/prd-09-web-control-panel-and-mobile.md)  
Status: Draft

## Outcome

Give users coherent workflow authoring, simulation, observability, review, approval, and control across the primary web surface and optional terminal/mobile surfaces.

## Epics and tasks

### E-CLIENT-01: Shared client model

- [ ] Define client view models for runs, graph state, node activity, artifacts, decisions, and approvals.
- [ ] Implement event cursor/reconnect handling.
- [ ] Implement redaction and role-aware presentation.
- [ ] Define common action confirmation and error behavior.

### E-CLIENT-02: TUI foundation

- [ ] Choose TUI framework and interaction model.
- [ ] Implement connection profiles and run list.
- [ ] Implement compact graph/run detail and node trace views.
- [ ] Implement event stream and reconnect.
- [ ] Implement artifact/log/diff inspection.
- [ ] Implement pause/resume/retry/cancel/approve controls.
- [ ] Add handoff/deep links to the web client for full authoring and simulation.

### E-CLIENT-03: Web control panel

- [ ] Implement auth, navigation, project/workspace, and run views.
- [ ] Implement visual workflow graph authoring and canonical package import/export.
- [ ] Implement validation, simulation launch, simulation results, and publication flow.
- [ ] Implement model-generated workflow proposal review with assumptions and risks.
- [ ] Implement artifact review and comments.
- [ ] Implement approval inbox and decision history.
- [ ] Implement configuration for workflows, targets, policies, and integrations.
- [ ] Implement timeline/graph and run report views.

### E-CLIENT-04: Responsive/mobile approval

- [ ] Define mobile-safe status and approval experience.
- [ ] Implement notification deep links and expiry.
- [ ] Add compact evidence/risk/decision views.
- [ ] Add step-up auth for high-risk actions.
- [ ] Test on constrained networks and small screens.

## SPIKEs

- [ ] S-CLIENT-01 TUI framework and compact graph/outline rendering.
- [ ] S-CLIENT-02 Artifact preview/security model.
- [ ] S-CLIENT-03 Self-hosted web packaging and local-daemon connection model.
- [ ] S-CLIENT-04 Notification and mobile approval delivery.

## Exit criteria

A user can start or observe a run in the TUI, review the same artifacts in web, approve a bounded action from a mobile-sized screen, and see one consistent decision history everywhere.
