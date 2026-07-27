# Epic-15: Workflow Authoring and Simulation

Source PRD: [PRD-15](../prds/prd-15-workflow-authoring-and-simulation.md)  
Status: Draft

## Outcome

Authoring clients and explicitly configured authoring workflows can create workflow packages, inspect them visually, validate them, simulate them safely, and publish immutable versions for execution.

## Epics and tasks

### E-AUTHOR-01: Canonical package and schema

- [ ] Define the package envelope, normalized representation, versioning, digest, and provenance.
- [ ] Define schemas for nodes, edges, context requirements, policies, capabilities, artifacts, and simulation settings.
- [ ] Implement import/export and semantic diff for the source and normalized forms.
- [ ] Define draft, review, published, deprecated, and rejected lifecycle states.

### E-AUTHOR-02: Visual web authoring

- [ ] Prototype the graph editor and large-graph navigation model.
- [ ] Add node/edge creation, contracts, conditions, loops, joins, approvals, transfer nodes, and terminal-state editing.
- [ ] Expose transfer-node target, condition, context-pruning, continuation, and failure options in the editor.
- [ ] Show capabilities, context access, side effects, policies, budgets, and unresolved validation issues.
- [ ] Add version comparison, review comments, and publication flow.

### E-AUTHOR-03: Validation and simulation

- [ ] Implement static graph and policy validation.
- [ ] Implement structural simulation with fixtures and fake node outputs.
- [ ] Implement shadow simulation with mocked writes and explicit provider/network policy.
- [ ] Prototype ephemeral Docker simulation with no origin push or deployment.
- [ ] Define simulation result schema, path coverage, suppressed-effects reporting, and artifact labeling.
- [ ] Add fixture replay and regression tests.

### E-AUTHOR-04: Model-generated workflows

- [ ] Define the model proposal contract and generated-source metadata.
- [ ] Generate candidate packages from supplied request data when an installation provides an authoring/decider workflow or service.
- [ ] Run generated packages through validation and simulation automatically.
- [ ] Present risks, unresolved assumptions, and simulation evidence for human review.
- [ ] Prevent publication or execution of an unreviewed invalid proposal.

## SPIKEs

- [ ] S-AUTHOR-01 Compare YAML, JSON, and dual-source package representations.
- [ ] S-AUTHOR-02 Evaluate graph-editor libraries and accessibility/large-graph behavior.
- [ ] S-AUTHOR-03 Define deterministic simulation semantics for model and external-service nodes.
- [ ] S-AUTHOR-04 Benchmark Docker simulation startup, isolation, and artifact collection.
- [ ] S-AUTHOR-05 Define future workflow-collection compatibility; defer packaging, installation, signing, and distribution mechanics.

## Exit criteria

An authoring client or explicitly configured authoring/decider workflow can propose a workflow, a user can inspect and edit the graph in the web control panel, simulate it with clearly labeled side-effect boundaries, review the evidence, publish a version, and start that exact version through the Control API.
