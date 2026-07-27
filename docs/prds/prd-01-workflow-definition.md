# PRD-01: Workflow Definition

Status: Draft  
Strategic context: [Platform Product Plan](../strategy/rostrum-end-to-end-product-plan.md#2-what-we-are-building-and-why)<br>
Delivery Epics: [Epic-01](../epics/epic-01-trusted-workflow-json.md), [Epic-02](../epics/epic-02-local-workflow-execution.md), [Epic-07](../epics/epic-07-workflow-simulation.md)<br>
Related PRD: [Workflow authoring, collaboration, and simulation](prd-15-workflow-authoring-and-simulation.md)

## Purpose

Define the portable, inspectable representation of a Rostrum workflow. A workflow must express the work to be done, the contracts between steps, the permissions and budgets that constrain it, and the evidence required to finish it.

## Users and use cases

### Workflow author

- Create a workflow from reusable node and subgraph definitions.
- Declare inputs, outputs, side effects, policies, budgets, and approval gates.
- Validate the workflow before publishing it.
- See the graph and understand possible paths, loops, and terminal states.
- Produce the same workflow JSON through visual editing, Git, or an AI coding agent using the Rostrum CLI.

### Workflow runner

- Start a versioned workflow with structured inputs.
- Invoke a selected workflow version with schema-validated structured inputs from a trigger, project, API, or caller.
- Run the same workflow locally, self-hosted, or through hosted execution.

### Reviewer and operator

- Inspect the workflow’s permissions and possible side effects before allowing it to run.
- Compare versions and understand which runs used which definition.

### Workflow-suite author

- Add reusable nodes, subgraphs, policies, and reference workflows for software development or another domain-specific suite.
- Depend on stable core primitives without changing the orchestrator.

## Goals

- Make workflow control flow and side effects explicit.
- Support sequential, branching, parallel, cyclic, approval, and child-workflow behavior.
- Make node handoffs structured and validate them before execution.
- Keep definitions portable across local, self-hosted, and hosted runtimes.
- Make workflows versioned, reviewable, and reproducible.

## Non-goals

- Choosing one model provider or agent implementation.
- Implementing the scheduler, sandbox, or user interface.
- Guaranteeing that a model’s output is correct.
- Defining the web authoring experience in this PRD; that is specified by PRD-15.

## Proposed model

The definition should contain:

| Area | Contents |
| --- | --- |
| Metadata | Name, owner, version, description, tags, compatibility, license |
| Inputs | Schema, defaults, required fields, sensitive-field declarations |
| State | Run-scoped values, schemas, retention, and visibility |
| Context | Required context views, selectors, freshness, sensitivity, and retention behavior |
| Nodes | Node type, configuration, input/output contracts, capabilities |
| Edges | Normal, conditional, error, retry, loop, join, and escalation paths |
| Policies | Tools, files, networks, models, credentials, approvals, budgets |
| Runtime | Required capabilities, target preference, resource limits |
| Artifacts | Expected outputs, evidence, retention, and publication rules |
| Completion | Success predicates, failure predicates, and blocked states |
| Triggers | Accepted event types and input mappings |
| Security | Trust level, data classification, allowed environments |
| Workflow JSON | Canonical normalized definition, schema version, revision, digest, and provenance |
| Simulation | Per-node allowed result variants, mock references, effects, expected paths, and suppressed side effects |

## Required features

### Must

- A stable schema for workflows, nodes, edges, policies, and contracts.
- Typed or schema-validated node inputs and outputs.
- Explicit node categories for reasoning, deterministic tools, control, approval, and subworkflow invocation.
- Explicit script nodes, transfer nodes, and typed output bindings between nodes.
- Branching, joins, bounded loops, retries, and escalation paths.
- Explicit success, failure, blocked, canceled, and expired terminal states.
- Versioning with immutable published versions and a draft lifecycle.
- Static validation for unreachable nodes, missing outputs, invalid loops, ambiguous joins, and policy conflicts.
- Canonical workflow JSON plus a human-readable graph view.
- Stable graph identities and semantics across visual edits, Rostrum revisions, Git review, CLI validation, and AI generation.
- Capability declarations so the runtime can reject a workflow that asks for unavailable or prohibited abilities.
- Context requirements so a node cannot receive source material outside the declared context policy.
- Input bindings so script/tool/model outputs cannot become downstream inputs without explicit author-defined mapping, size, and policy declarations, plus schema validation where declared.
- Transfer-node configuration so a conversation can move to another model/runtime with explicit conditions, context-pruning rules, continuation state, and failure behavior.
- Per-node simulation contracts so allowed mock outputs, states, effects, artifacts, and fixtures are explicit.

### Should

- Reusable subgraphs with parameterized inputs.
- Schema evolution and compatibility checks.
- Conditional policies based on environment, data classification, or risk.
- References to external templates, workflow collections, and tool registries.
- Definition-level test fixtures and sample runs.
- Semantic diff and merge suitable for Rostrum-managed revisions and Git review.

### Could

- Compile-time cost and reachability estimates.
- Formal verification for selected graph properties.
- Additional deterministic source formats that compile to workflow JSON.

## Acceptance criteria

1. An author can define a review-only and guided-build workflow without embedding scheduler logic in application code.
2. The validator rejects a workflow with an unbounded loop or missing terminal path.
3. A workflow version can be referenced immutably by a run after the draft changes.
4. The same workflow can be loaded by a local runtime and a remote runtime through the same contract.
5. A reviewer can see which nodes may mutate files, access networks, use secrets, or trigger deployment.
6. The definition can express a human approval gate and a bounded verify-fix loop.

## Open questions and SPIKEs

- JSON Schema, generated types, or both as validation and SDK sources.
- How dynamic graph construction is constrained and recorded.
- Stable graph identity and semantic merge across concurrent edits.
- How much of a workflow’s prompt/context configuration is visible in reviews.

## Ownership boundary

The workflow JSON schema, validator, generated types, local authoring contracts, and reference workflows should be open-source. Hosted retention and organization policy services may be cloud capabilities but should use public contracts.
