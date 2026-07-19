# PRD-01: Workflow Definition

Status: Draft  
Strategic context: [End-to-End Product Plan](../strategy/rostrum-end-to-end-product-plan.md#5-the-product-model)  
Primary epic: [Workflow definition epics](../epics/epic-01-workflow-definition.md)

## Purpose

Define the portable, inspectable representation of a Rostrum workflow. A workflow must express the work to be done, the contracts between steps, the permissions and budgets that constrain it, and the evidence required to finish it.

## Users and use cases

### Workflow author

- Create a workflow from reusable node and subgraph definitions.
- Declare inputs, outputs, side effects, policies, budgets, and approval gates.
- Validate the workflow before publishing it.
- See the graph and understand possible paths, loops, and terminal states.

### Workflow runner

- Start a versioned workflow with structured inputs.
- Resolve a workflow from a trigger, project, or user request.
- Run the same workflow locally, self-hosted, or through hosted execution.

### Reviewer and operator

- Inspect the workflow’s permissions and possible side effects before allowing it to run.
- Compare versions and understand which runs used which definition.

### Domain-pack author

- Add reusable nodes, subgraphs, policies, and reference workflows for software development or another domain.
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
- Providing a visual editor in the first release.

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

## Required features

### Must

- A stable schema for workflows, nodes, edges, policies, and contracts.
- Typed or schema-validated node inputs and outputs.
- Explicit node categories for reasoning, deterministic tools, control, approval, and subworkflow invocation.
- Branching, joins, bounded loops, retries, and escalation paths.
- Explicit success, failure, blocked, canceled, and expired terminal states.
- Versioning with immutable published versions and a draft lifecycle.
- Static validation for unreachable nodes, missing outputs, invalid loops, ambiguous joins, and policy conflicts.
- A machine-readable representation plus a human-readable graph view.
- Capability declarations so the runtime can reject a workflow that asks for unavailable or prohibited abilities.
- Context requirements so a node cannot receive source material outside the declared context policy.

### Should

- Reusable subgraphs with parameterized inputs.
- Schema evolution and compatibility checks.
- Conditional policies based on environment, data classification, or risk.
- References to external templates, domain packs, and tool registries.
- Definition-level test fixtures and sample runs.
- A source representation suitable for code review and Git versioning.

### Could

- A visual graph editor.
- Compile-time cost and reachability estimates.
- Formal verification for selected graph properties.
- A registry of community workflows and signed packages.

## Acceptance criteria

1. An author can define a review-only and guided-build workflow without embedding scheduler logic in application code.
2. The validator rejects a workflow with an unbounded loop or missing terminal path.
3. A workflow version can be referenced immutably by a run after the draft changes.
4. The same workflow can be loaded by a local runtime and a remote runtime through the same contract.
5. A reviewer can see which nodes may mutate files, access networks, use secrets, or trigger deployment.
6. The definition can express a human approval gate and a bounded verify-fix loop.

## Open questions and SPIKEs

- Declarative format versus code-first SDK, or a combination.
- JSON Schema, typed language types, or both as the contract source of truth.
- How dynamic graph construction is constrained and recorded.
- Whether workflow packages are signed and how trust is established.
- How much of a workflow’s prompt/context configuration is visible in reviews.

## Ownership boundary

The schema, validator, SDK, local authoring, and reference workflows should be open-source. A hosted registry, package signing service, and organization policy distribution may be hosted capabilities but should use public contracts.
