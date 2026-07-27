# PRD-15: Workflow Authoring and Simulation

Status: Draft  
Strategic context: [High-Level Build Blueprint](../strategy/rostrum-high-level-build-blueprint.md#49-control-clients)  
Primary epic: [Workflow authoring and simulation epic](../epics/epic-15-workflow-authoring-and-simulation.md)

## Purpose

Make Rostrum workflows understandable and safe to create. The web control panel is the primary authoring surface: a person or an explicitly configured authoring workflow/service can create a workflow, see its graph, validate it, simulate it, review the result, and publish an immutable version before a real run is allowed.

## Users and use cases

- A workflow author creates and edits a graph without hand-writing every edge.
- An engineer reviews a Git-friendly workflow package in a code review.
- An explicitly enabled authoring workflow or service proposes a workflow from supplied request data.
- A reviewer sees the proposed graph, policies, context requirements, and likely paths before approving it.
- An operator simulates a workflow with fixtures or an ephemeral Docker workspace before enabling it.
- A workflow-suite author defines reusable nodes, subgraphs, fixtures, and reference workflows.

## Goals

- Keep a canonical, portable, machine-readable workflow package.
- Make graph structure, contracts, context access, policies, and side effects visible.
- Support model-generated workflow proposals without allowing them to bypass validation or approval.
- Make simulation useful before execution and explicit about what it can and cannot prove.
- Keep authoring, validation, and simulation usable against a local daemon or remote Control API.

## Non-goals

- Proving that a model-generated workflow is semantically correct.
- Replacing the durable daemon with a browser-side execution engine.
- Allowing simulation to perform real external writes by default.
- Making natural-language intake or workflow selection an implicit responsibility of the core platform.
- Finalizing the storage engine or graph-editor library in this PRD.

## Canonical workflow package

The initial direction is a Git-friendly source representation, likely YAML, with a normalized JSON form for API interchange and validation. The exact serialization choice remains a SPIKE, but both forms must describe the same package. A package should include:

- metadata, version, compatibility, and provenance;
- input/output schemas and sensitive-field declarations;
- nodes, edges, branches, joins, loops, retries, approvals, and terminal states;
- node contracts, capability declarations, context requirements, and policies;
- model/provider/runnable references and execution-target requirements;
- artifact declarations, evidence requirements, budgets, and retention;
- simulation fixtures, mocks, expected paths, and side-effect settings;
- optional generated-source metadata linking a proposal to its prompt and review.

Published packages are immutable and addressable by version or digest. Drafts can be edited, diffed, imported, exported, and collaboratively reviewed. A run always records the exact package version or digest it used.

## Required features

### Must

- Visual graph editing for nodes, edges, conditions, loops, joins, approvals, transfer nodes, and terminal states.
- Transfer-node configuration for target, condition, context pruning, continuation state, and failure behavior.
- A graph view that exposes capabilities, context requirements, side effects, policies, and budgets.
- Import/export of a Git-friendly canonical package and normalized API representation.
- Static validation for schema errors, unreachable paths, missing terminal states, invalid joins, unbounded loops, undeclared capabilities, and policy conflicts.
- A model proposal flow, when an installation provides one: supplied request/input → draft package → validation → visual review → simulation → human review → publication.
- Simulation runs that are clearly distinct from real runs and cannot silently mutate external systems.
- Simulation output containing traversed paths, node results, policy decisions, failures, timing/cost estimates where available, and generated artifacts.
- Version comparison and a publication gate that records who approved the package and which validation/simulation results supported it.
- API support so CLI, SDK, TUI, and integrations can validate and simulate the same package.

### Should

- Structural simulation using fake node outputs and no model/provider calls.
- Shadow simulation using real model calls but mocked writes, credentials, and external side effects.
- Ephemeral Docker simulation for build/test behavior without pushing changes or deploying.
- Fixture replay for deterministic node and policy regression tests.
- Path coverage and branch reachability visualization.
- Model-generated explanations of graph structure and detected risks.

### Could

- Interactive step-through simulation.
- Formal verification for selected graph properties.
- Workflow package signatures and a trusted registry.
- Collaborative multi-user editing.

## Simulation safety model

Simulation is not one guarantee. The UI and API must label the simulation level and its permitted effects:

| Level | Purpose | Default side effects |
| --- | --- | --- |
| Static validation | Check package structure and policy consistency | None |
| Structural simulation | Exercise graph control flow with fixtures/fakes | None |
| Shadow simulation | Evaluate selected real model behavior | No writes, no unapproved credentials, mocked external calls |
| Docker simulation | Run tools/builds in an ephemeral isolated workspace | No origin push, deployment, or unapproved network access |
| Fixture replay | Re-run known inputs and decisions for regression | Defined only by fixture harness |

Every simulation result must state which nodes were mocked, which providers were contacted, which credentials were available, and which effects were suppressed. A simulation may produce artifacts, but those artifacts are simulation outputs and must not be confused with a production run.

## Acceptance criteria

1. A user can create a small workflow visually, export it, import it, and see an equivalent graph.
2. The validator rejects a workflow with an undeclared capability, policy conflict, or unbounded loop.
3. A model-generated workflow cannot be published without passing validation and an explicit review/publication action.
4. A user can simulate a workflow and distinguish simulated state, artifacts, model calls, and suppressed side effects from a real run.
5. A run records the immutable workflow package version used to execute it.
6. CLI/SDK clients can invoke validation, simulation, and publication through the same Control API as the web client.

## Open questions and SPIKEs

- YAML, JSON, or a dual-source approach as the canonical authoring format.
- Graph-editor library, large-graph interaction model, and accessibility requirements.
- How deterministic structural simulation should be when model nodes are replaced with fixtures.
- Safe shadow-simulation provider access and cost limits.
- How much generated prompt/context metadata should be retained with a draft.
- Future workflow-collection compatibility and dependency semantics; packaging/distribution is deferred.

## Ownership boundary

The package schema, validator, visual editor, simulation engine, fixtures, and local/self-hosted authoring APIs should be open-source. A hosted registry, managed simulation fleet, proprietary evaluation, and hosted collaboration/retention services may be cloud offerings behind the same public contracts.
