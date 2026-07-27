# Epic-12: Showcase Suite

Milestone: M12
Source plan: [Platform Product Plan showcase suite](../strategy/rostrum-end-to-end-product-plan.md#4-showcase-suite)
Source PRDs: [PRD-11](../prds/prd-11-software-delivery-workflows.md), [PRD-13](../prds/prd-13-deployment-release-and-live-validation.md), and the platform PRDs used by each showcase
Status: Draft

## Outcome

Repeatable workflows for product management, AI-assisted authoring, software delivery, operations, and deterministic data processing prove that Rostrum is a generic platform.

## Tasks

### Showcase harness

- [ ] Define versioned inputs, policies, mocks, expected artifacts, evidence, and pass/fail criteria.
- [ ] Build local Docker fixtures and a common run report.
- [ ] Reject hidden domain-specific daemon, API, client, or execution paths.

### Product-management showcases

- [ ] Build the product-discovery brief workflow with approved context, parallel synthesis, questions, revision, and approval.
- [ ] Build the roadmap-prioritization workflow with container-defined scoring, dependency analysis, scenarios, stakeholder mocks, and approval.
- [ ] Define evidence-quality, traceability, tradeoff, and decision-readiness rubrics.

### Platform and software showcases

- [ ] Demonstrate an AI coding agent creating, validating, uploading, reviewing, simulating, and publishing workflow JSON.
- [ ] Build and run the secure note-taking workflow through planning, isolated implementation, verification, deployment, live validation, and rollback.

### Operations and deterministic showcases

- [ ] Build the incident-investigation and governed-remediation workflow.
- [ ] Build the cross-system data-reconciliation workflow with container scripts, fan-out, idempotency, exceptions, and reporting.
- [ ] Prove the reconciliation workflow completes without model nodes.

## SPIKEs

- [ ] Define representative fixtures without retaining sensitive source data.
- [ ] Define quality, cost, duration, and determinism budgets.
- [ ] Define controlled reference deployment environments and live dependencies.

## Exit criteria

Every showcase has versioned workflow JSON, reproducible fixtures, explicit decisions, deterministic gates, and a complete evidence report. All pass on self-hosted Docker without domain-specific changes to public product contracts.
