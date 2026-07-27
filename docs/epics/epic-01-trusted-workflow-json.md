# Epic-01: Trusted Workflow JSON

Milestone: M1
Source PRDs: [PRD-01](../prds/prd-01-workflow-definition.md), [PRD-07](../prds/prd-07-control-plane-api-and-local-daemon.md), [PRD-15](../prds/prd-15-workflow-authoring-and-simulation.md)
Status: Draft

## Outcome

Humans and AI systems can create workflow JSON, receive actionable validation results, upload it through the Control API, and retrieve the immutable registered version and digest.

## Tasks

### Workflow contract

- [ ] Define the workflow JSON envelope, schema version, graph identities, node/edge contracts, policies, completion states, provenance, and digest.
- [ ] Publish JSON Schema and generated validation types.
- [ ] Create valid and invalid conformance fixtures.

### Validation and registry

- [ ] Validate graph structure, bindings, loops, terminal paths, capabilities, and policy references.
- [ ] Return stable machine-readable diagnostics with graph locations.
- [ ] Implement minimal Control API resources for drafts, validation, upload, published versions, and digest retrieval.

### CLI and authoring skill

- [ ] Implement workflow `validate`, `upload`, `download`, `inspect`, and `diff`.
- [ ] Define stable exit codes and JSON output for automation.
- [ ] Publish the first Rostrum authoring skill with examples and a validate/repair/upload loop.
- [ ] Run human-authored and AI-authored fixtures through identical controls.

## SPIKEs

- [ ] Select the JSON Schema and generated-type toolchain.
- [ ] Define stable graph identity and semantic normalization.
- [ ] Define local versus Control API validation parity.

## Exit criteria

A human and an AI coding agent can independently produce workflow JSON, repair validation errors, upload the result, and retrieve the same immutable normalized definition and digest.
