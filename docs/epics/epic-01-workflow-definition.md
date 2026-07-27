# Epic-01: Workflow Definition

Source PRD: [PRD-01](../prds/prd-01-workflow-definition.md)  
Status: Draft

## Outcome

Provide a versioned, portable, validated representation of Rostrum workflows and workflow graphs.

## Epics and tasks

### E-WF-01: Core schema and contracts

- [ ] Define workflow, node, edge, policy, runtime, artifact, and completion schemas.
- [ ] Define node input/output contract conventions and schema references.
- [ ] Define explicit input bindings, output formats, stream/materialization rules, and downstream piping contracts.
- [ ] Define sensitive-field and visibility annotations.
- [ ] Add schema versioning and compatibility metadata.
- [ ] Publish example workflows for review-only, planning, and guided build.

### E-WF-02: Graph validation

- [ ] Validate graph connectivity and unreachable nodes.
- [ ] Validate input/output references and join requirements.
- [ ] Detect unbounded loops and missing exit conditions.
- [ ] Detect conflicting capability and policy declarations.
- [ ] Produce actionable validation errors with graph locations.

### E-WF-03: Workflow lifecycle and registry

- [ ] Implement draft, review, publish, deprecate, and archive lifecycle.
- [ ] Make published versions immutable.
- [ ] Add workflow diff and run-to-version provenance.
- [ ] Define local file registry and hosted registry adapters.

### E-WF-04: Composition and workflow collections

- [ ] Define reusable subgraph references and parameter passing.
- [ ] Define node/tool/skill capability metadata.
- [ ] Define script-node and transfer-node metadata, including conditions, pruning, continuation, and failure behavior.
- [ ] Create software-delivery workflow collection structure.
- [ ] Add collection compatibility and dependency checks without defining distribution mechanics.

## SPIKEs

- [ ] S-WF-01 Declarative format versus code-first SDK prototype.
- [ ] S-WF-02 JSON Schema versus typed contract source of truth.
- [ ] S-WF-03 Dynamic graph generation safety and provenance.
- [ ] S-WF-04 Workflow package signing and trust model.
- [ ] S-WF-05 Visual graph representation for large and cyclic workflows.

## Exit criteria

Three reference workflows validate, serialize, diff, and execute through the runtime without workflow-specific scheduler code, including at least one workflow with structured script output piped into downstream nodes.
