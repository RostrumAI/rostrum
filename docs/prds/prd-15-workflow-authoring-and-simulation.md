# PRD-15: Workflow Authoring, Collaboration, and Simulation

Status: Draft  
Strategic context: [Platform Product Plan](../strategy/rostrum-end-to-end-product-plan.md#2-what-we-are-building-and-why)
Delivery Epics: [Epic-01](../epics/epic-01-trusted-workflow-json.md), [Epic-07](../epics/epic-07-workflow-simulation.md), [Epic-08](../epics/epic-08-control-applications.md), [Epic-11](../epics/epic-11-collaborative-authoring.md)

## Purpose

Make workflow JSON safe for humans and AI systems to create together. Authors should be able to work visually, through the CLI, or in Git; review the same underlying revisions; simulate node behavior with controlled mocks; and publish an immutable version for execution.

## Users and use cases

- A team co-authors a workflow through shared, revisioned drafts.
- An engineer exports workflow JSON to a branch and reviews it in a pull request.
- An AI coding agent uses the Rostrum authoring skill and CLI to create, validate, and upload workflow JSON.
- A reviewer compares semantic graph changes rather than only line-oriented JSON changes.
- An author configures allowed mock outputs for each node and simulates possible paths.
- A team publishes the exact reviewed and simulated revision.

## Goals

- Keep workflow JSON as the portable executable contract.
- Support Rostrum-managed collaboration and Git-based review without requiring either one.
- Make every edit attributable, diffable, reviewable, and recoverable.
- Give each node an explicit simulation contract.
- Provide a rich mock-data library for realistic graph tests.
- Prevent AI-generated or collaboratively edited drafts from bypassing validation and publication controls.

## Non-goals

- Treating Git as the storage engine for live multi-user editing.
- Proving that model-generated logic is semantically correct.
- Allowing simulation to perform undeclared external writes.
- Making prompt intake an implicit Rostrum behavior.
- Defining workflow marketplace or distribution mechanics.

## Workflow JSON

Workflow JSON contains:

- metadata, schema version, revision provenance, and compatibility;
- workflow input/output schemas and sensitive-field declarations;
- nodes, edges, branches, joins, loops, retries, approvals, and terminal states;
- node contracts, capabilities, context requirements, provider references, policies, and targets;
- artifact, evidence, budget, and retention requirements;
- per-node simulation contracts and mock references.

Every published workflow is immutable and addressable by version and digest. Optional human-friendly source formats may compile to workflow JSON later, but the validator, Control API, daemon, CLI, SDK, and clients operate on the normalized JSON contract.

## Collaboration model

### Rostrum-managed drafts

- Drafts contain immutable revisions with author, parent revision, timestamp, and change metadata.
- Authors may fork a draft, compare revisions, merge compatible changes, and resolve semantic conflicts.
- Comments and review decisions attach to workflow, node, edge, policy, or revision identities.
- Optimistic concurrency prevents one client from silently overwriting another author's revision.
- Publication records the approved revision, validator version, simulation evidence, reviewers, and resulting digest.

### Git-based collaboration

- Workflow JSON and referenced mock fixtures can be exported to and imported from a repository.
- Semantic diff and merge operate on stable graph identities rather than JSON line order.
- Commit, branch, pull-request, and reviewer metadata can be attached as provenance.
- A Git repository is an optional collaboration path, not a runtime dependency or live-editing backend.

## CLI and AI authoring skill

The initial workflow CLI surface is intentionally focused:

- `validate` workflow JSON locally or against a selected Control API;
- `upload` a validated draft or immutable version;
- `download` an exact revision or published version;
- `inspect` normalized structure, capabilities, policies, and unresolved references;
- `diff` two revisions semantically;
- return machine-readable diagnostics and stable exit codes.

The open-source Rostrum authoring skill should include schema guidance, examples, validation commands, common repair patterns, simulation guidance, and a checklist for producing reviewable workflow JSON. An AI author remains an ordinary CLI/API client and receives no validation or publication bypass.

## Per-node simulation

Each node declares:

- the output schema and allowed mock result variants;
- whether success, failure, timeout, retry, approval, cancellation, or partial-result states may be mocked;
- fixture, generated, replayed, or explicitly real behavior;
- allowed artifacts, timing/cost metadata, and side effects;
- mock references and default selection rules.

Rostrum provides reusable mock builders and fixtures for:

- model responses, tool calls, usage, latency, and provider failure;
- deterministic tools and container-defined script outputs;
- context views, redaction, provenance, and unavailable sources;
- integration callbacks, rate limits, malformed payloads, and outages;
- human approval, rejection, questions, expiry, and delayed response;
- artifacts, large collections, partial failures, and retry sequences.

A simulation result records the mode used for every node, the supplied mock data, traversed paths, policy decisions, suppressed effects, generated artifacts, and uncovered branches. A node may execute for real only when its simulation contract and active policy explicitly permit it.

## Required features

### Must

- Visual graph editing backed by workflow JSON.
- Revision history, fork, semantic diff, conflict detection, comments, review, and immutable publication.
- Git import/export and provenance.
- Static validation for schema errors, unreachable paths, missing terminal states, invalid joins, unbounded loops, undeclared capabilities, and policy conflicts.
- CLI validation/upload/download/inspect/diff with machine-readable results.
- Per-node simulation contracts and reusable mock-data APIs.
- Simulation path, node-mode, policy, artifact, and suppressed-effect reporting.
- Publication gates bound to a specific validated and reviewed revision.

### Should

- Presence indicators and collaborative cursors.
- Fixture generation from historical node results after explicit redaction and approval.
- Path coverage and branch reachability visualization.
- Regression suites that run in CI through the CLI.
- Semantic three-way merge for independently edited drafts.

### Could

- Interactive simulation stepping.
- Formal verification for selected graph properties.
- Additional source formats that compile deterministically to workflow JSON.

## Acceptance criteria

1. Two authors cannot silently overwrite each other's workflow changes.
2. A workflow round-trips between visual editing, workflow JSON, CLI validation, and Git without changing its normalized meaning.
3. An AI coding agent can use the authoring skill to produce a workflow, repair validation errors, and upload a draft without receiving publication authority.
4. Every simulated node result conforms to the node's declared simulation contract.
5. A simulation report identifies every mocked or real node and every suppressed effect.
6. A run records the exact immutable workflow digest approved for execution.

## Open questions and SPIKEs

- Draft revision storage and semantic merge algorithm.
- Stable graph identity across visual, JSON, and Git edits.
- Real-time collaboration protocol and presence model.
- Graph-editor library, large-graph navigation, and accessibility.
- Mock-data API ergonomics, fixture versioning, and safe historical-result capture.
- Deterministic compilation rules for any future non-JSON source format.

## Ownership boundary

Workflow JSON schemas, validators, CLI, authoring skill, revision and diff contracts, visual editor, per-node simulation contracts, mock library, Git bridge, and local/self-hosted authoring APIs should be open-source. Rostrum Cloud may provide managed draft retention, notifications, large-team collaboration, and simulation capacity behind the same public contracts.
