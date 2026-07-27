# Rostrum: Platform Product Plan

Status: Rough first draft for product and architecture discussion  
Depends on: [High-Level Build Blueprint](rostrum-high-level-build-blueprint.md)  
Audience: Product, engineering, design, security, and operations

## Purpose

The [High-Level Build Blueprint](rostrum-high-level-build-blueprint.md) describes Rostrum's architecture and boundaries. This document defines the product to deliver, the order in which it becomes useful, and the showcases that prove it is complete.

Rostrum defines and executes workflows. A caller selects a workflow and supplies its declared inputs. Prompt intake, request interpretation, and workflow selection only exist when a user builds or connects a workflow that performs those jobs.

## Contents

- [1. Product scope](#1-product-scope)
- [2. What we are building and why](#2-what-we-are-building-and-why)
- [3. Delivery milestones](#3-delivery-milestones)
- [4. Showcase suite](#4-showcase-suite)
- [5. Product boundaries](#5-product-boundaries)
- [6. Finalized Rostrum state](#6-finalized-rostrum-state)

## 1. Product scope

### Rostrum provides

- Versioned workflow JSON definitions.
- Durable graph execution across model, deterministic, script, integration, approval, and control nodes.
- Typed node inputs and outputs, explicit policies, and required evidence.
- Read-only, pass-through access to approved external context.
- Docker isolation for local/self-hosted runs and microVM isolation for Rostrum Cloud.
- One Control API shared by clients, SDKs, and integrations.
- Co-authoring, validation, per-node simulation, publication, observation, and governance.

### Rostrum does not implicitly provide

- General-purpose chat or prompt intake.
- Automatic workflow selection.
- A mandatory workflow domain.
- Workflow marketplace, packaging, signing, distribution, or monetization in the initial product.

## 2. What we are building and why

| Product area | What we build | Why it exists |
| --- | --- | --- |
| Workflow definition | Portable, versioned workflow JSON with graph, schema, policy, budget, evidence, and completion contracts | Gives humans, AI authors, clients, and runtimes one executable source of truth |
| Authoring and collaboration | Visual editing, revisioned drafts, semantic diffs, comments, review, immutable publication, and Git import/export | Supports live co-authoring as well as branch-and-pull-request review |
| Simulation and mock library | Per-node simulation contracts defining allowed mock results and effects, plus reusable mock data for models, tools, context, integrations, and human decisions | Lets workflows exercise realistic paths without pretending a simulation is a real run |
| Rostrum daemon | Durable scheduler and graph executor with retries, checkpoints, waits, recovery, and cancellation | Keeps execution correct when clients disconnect or workers fail |
| Control API | Contracts for workflow versions, runs, events, controls, approvals, artifacts, configuration, and provider/context references | Gives every client and integration one authoritative boundary |
| Web and desktop control app | Shared web application with an installable Electron or equivalent desktop shell; responsive approval views for mobile browsers | Provides the primary authoring, simulation, review, and run-management experience |
| CLI | Local and remote validation, upload, download, inspection, and diffing of workflow JSON, with machine-readable results | Lets humans and AI systems create Rostrum workflows verifiably outside the visual editor |
| Rostrum authoring skill | Instructions and fixtures that teach an AI coding agent to produce workflow JSON and use the CLI validation/upload loop | Makes AI-authored workflows practical without making prompt intake part of Rostrum |
| SDK | Typed programmatic clients for invoking selected workflows, observing or waiting on runs, controlling execution, submitting decisions, and retrieving artifacts | Embeds Rostrum in applications, CI, and internal platforms |
| Model Provider Layer | Provider-neutral model catalog, authentication, capability discovery, request/response normalization, routing, fallback, and usage accounting | Separates model access from workflow logic and from the Context Layer |
| Model runtime | Structured reasoning nodes, tool boundaries, model execution strategies, context limits, and traceability | Adds probabilistic reasoning without making models the source of workflow truth |
| Deterministic tools and scripts | Built-in tools plus container-defined script nodes supplied as an image, Dockerfile/build context, or equivalent runnable definition | Lets workflow authors bring any runtime while owning its dependencies and output behavior |
| Context Layer | Read-only, policy-filtered, just-in-time access to repositories, Slack, Discord, documentation, incidents, and other sources | Supplies project knowledge without exposing source credentials or requiring a source-content cache |
| Sandboxing | Docker targets for local/self-hosted execution and Rostrum Cloud microVM targets | Keeps code, scripts, tools, dependencies, and credentials outside the daemon and user host |
| State and observability | Durable run state, event streams, artifacts, traces, costs, policy decisions, and audit records | Makes runs recoverable and their results inspectable |
| Governance and approvals | Users, teams, groups, projects, policies, budgets, credentials, approvals, and kill switches | Makes consequential workflows safe to operate |
| Integrations | Authenticated triggers, callbacks, notifications, external jobs, and structured result publishing | Connects workflows to the systems that initiate work and consume outcomes |

## 3. Delivery milestones

Milestone and Epic numbers match one-to-one. Each Epic contains the work needed to reach its corresponding product state. [Epic-00](../epics/epic-00-delivery-roadmap.md) coordinates the complete sequence.

| Milestone | Product state | Delivery Epic | Exit demonstration |
| --- | --- | --- | --- |
| M1 | Workflow JSON can be trusted | [Epic-01: Trusted workflow JSON](../epics/epic-01-trusted-workflow-json.md) | A human or AI creates workflow JSON, validates it locally, uploads it, and retrieves its immutable version and digest. |
| M2 | A workflow can execute locally | [Epic-02: Local workflow execution](../epics/epic-02-local-workflow-execution.md) | The daemon accepts an explicit workflow invocation and executes sequential, branching, and terminal control flow through the Control API. |
| M3 | A run can survive, wait, and be inspected | [Epic-03: Durable runs and human control](../epics/epic-03-durable-runs-and-human-control.md) | A run survives restart and reconnect, exposes events and artifacts, retries bounded failures, and pauses and resumes around a human decision. |
| M4 | A workflow can safely run tools and scripts | [Epic-04: Docker tools and scripts](../epics/epic-04-docker-tools-and-scripts.md) | A workflow runs built-in tools and a container-defined script in Docker, applies policy, and binds captured results into downstream nodes without losing durable evidence. |
| M5 | Models can be used in workflows | [Epic-05: Model providers and model nodes](../epics/epic-05-model-providers-and-nodes.md) | A model node executes through the provider-neutral layer with structured output, scoped credentials, policy, usage accounting, retry, and fallback. |
| M6 | Project context can be used in workflows | [Epic-06: Project context](../epics/epic-06-project-context.md) | A node receives a read-only, filtered context view with provenance while source credentials and source bodies remain outside the run record by default. |
| M7 | Workflows can be simulated | [Epic-07: Workflow simulation](../epics/epic-07-workflow-simulation.md) | A workflow runs through per-node mocks, reports traversed and uncovered paths, and identifies every simulated result and suppressed effect. |
| M8 | Workflows can be authored and operated visually | [Epic-08: Control applications](../epics/epic-08-control-applications.md) | One user can visually edit, validate, simulate, publish, invoke, observe, and control a workflow from web or desktop, with mobile-responsive decisions. |
| M9 | Applications can embed Rostrum | [Epic-09: SDK](../epics/epic-09-sdk.md) | An application invokes a selected workflow, observes or waits on the run, submits a decision, and retrieves structured results and artifacts through a typed SDK. |
| M10 | External systems can participate | [Epic-10: Integrations](../epics/epic-10-integrations.md) | A repository, CI system, schedule, alert, or external application invokes an explicit workflow and receives authenticated, replay-safe outcomes. |
| M11 | Teams can co-author workflows | [Epic-11: Collaborative authoring](../epics/epic-11-collaborative-authoring.md) | Multiple authors create revisions, avoid silent overwrites, compare and merge changes, review in Rostrum or Git, and publish the approved revision. |
| M12 | The showcase suite proves product breadth | [Epic-12: Showcase suite](../epics/epic-12-showcase-suite.md) | Every showcase below passes through the same public workflow, execution, policy, evidence, and client contracts on self-hosted Docker. |
| M13 | Rostrum can be operated as Cloud | [Epic-13: Rostrum Cloud](../epics/epic-13-rostrum-cloud.md) | The same workflow JSON and Control API operate across tenants with managed identity, credentials, quotas, billing, operations, and microVM isolation. |
| Final | Rostrum matches the finalized product state | Epics 01–13, in order | A team can define, simulate, operate, integrate, co-author, and govern workflows; run every node type durably across supported isolation targets; inspect complete evidence; and reproduce the showcase suite locally, self-hosted, and in Rostrum Cloud. |

## 4. Showcase suite

| What to showcase | What it proves | What's needed |
| --- | --- | --- |
| **Product discovery brief (product owner/manager):** turn approved customer feedback, product analytics, support themes, and strategy documents into a reviewable opportunity brief and proposed requirements | • Parallel pass-through context retrieval with provenance<br>• Model synthesis through the provider layer<br>• Human questions, comments, revision, and approval<br>• Artifact lineage from evidence to product decisions | • [Epic-05: Model providers and model nodes](../epics/epic-05-model-providers-and-nodes.md)<br>• [Epic-06: Project context](../epics/epic-06-project-context.md)<br>• [Epic-08: Control applications](../epics/epic-08-control-applications.md)<br>• [Epic-10: Integrations](../epics/epic-10-integrations.md) |
| **Roadmap prioritization and release plan (product owner/manager):** combine objectives, backlog items, dependencies, capacity, and stakeholder constraints into scored scenarios and an approved roadmap | • Container-defined scoring and dependency scripts<br>• Typed script output feeding model and decision nodes<br>• Fan-out, joins, scenario comparison, and durable approval waits<br>• Per-node mocks for changing capacity and stakeholder inputs | • [Epic-03: Durable runs and human control](../epics/epic-03-durable-runs-and-human-control.md)<br>• [Epic-04: Docker tools and scripts](../epics/epic-04-docker-tools-and-scripts.md)<br>• [Epic-07: Workflow simulation](../epics/epic-07-workflow-simulation.md)<br>• [Epic-08: Control applications](../epics/epic-08-control-applications.md) |
| **AI-authored Rostrum workflow:** give an AI coding agent the Rostrum authoring skill, have it produce workflow JSON, validate and upload it through the CLI, then review and simulate it visually | • AI can create workflows without privileged product behavior<br>• Workflow JSON is portable and machine-verifiable<br>• Invalid or unsafe AI output cannot be published silently<br>• CLI, Control API, visual editor, and simulator share one contract | • [Epic-01: Trusted workflow JSON](../epics/epic-01-trusted-workflow-json.md)<br>• [Epic-07: Workflow simulation](../epics/epic-07-workflow-simulation.md)<br>• [Epic-08: Control applications](../epics/epic-08-control-applications.md)<br>• [Epic-11: Collaborative authoring](../epics/epic-11-collaborative-authoring.md) |
| **Secure note-taking application delivery:** build, test, and release a secure application for web, desktop, and mobile from an approved product brief | • Model and deterministic nodes can coordinate a large outcome<br>• Parallel work remains isolated in Docker or Cloud microVMs<br>• Git branches, independent verification, and repair loops compose reliably<br>• Deployment, live dependency checks, approvals, and rollback produce evidence | • [Epic-04: Docker tools and scripts](../epics/epic-04-docker-tools-and-scripts.md)<br>• [Epic-05: Model providers and model nodes](../epics/epic-05-model-providers-and-nodes.md)<br>• [Epic-12: Showcase suite](../epics/epic-12-showcase-suite.md)<br>• Secure note-taking reference repositories and environments |
| **Incident investigation and governed remediation:** receive an alert, gather approved service context, reproduce the failure, propose a repair, wait for approval, deploy, and monitor | • External triggers can start durable workflows<br>• Read-only context and write-capable remediation remain separate<br>• Risk policies and approvals constrain production actions<br>• Failure, retry, rollback, and escalation paths survive long waits | • [Epic-03: Durable runs and human control](../epics/epic-03-durable-runs-and-human-control.md)<br>• [Epic-04: Docker tools and scripts](../epics/epic-04-docker-tools-and-scripts.md)<br>• [Epic-06: Project context](../epics/epic-06-project-context.md)<br>• [Epic-10: Integrations](../epics/epic-10-integrations.md) |
| **Cross-system data reconciliation:** read records from two systems, normalize them with container-defined scripts, fan out comparisons, route exceptions for review, and publish a reconciliation report | • Rostrum is useful without model nodes<br>• Container-defined scripts, typed piping, idempotency, and per-record failure compose<br>• Parallel execution and joins produce deterministic artifacts<br>• Mock connectors can test external-system behavior safely | • [Epic-03: Durable runs and human control](../epics/epic-03-durable-runs-and-human-control.md)<br>• [Epic-04: Docker tools and scripts](../epics/epic-04-docker-tools-and-scripts.md)<br>• [Epic-10: Integrations](../epics/epic-10-integrations.md)<br>• [Epic-12: Showcase suite](../epics/epic-12-showcase-suite.md) |

## 5. Product boundaries

### Open-source and self-hostable

- Workflow JSON schema, validator, authoring skill, CLI, SDK, and Control API.
- Rostrum daemon, web application, desktop application, and mobile-responsive views.
- Revisioned draft, Git import/export, review, publication, and per-node simulation contracts.
- Model Provider Layer contracts and self-hosted provider adapters.
- Context Layer contracts, broker, and self-hosted connectors.
- Deterministic tools, container-defined script nodes, Docker execution, state, events, artifacts, and conformance tests.
- Showcase workflow definitions and local fixtures.

### Rostrum Cloud

- Managed tenancy, identity, credentials, retention, notifications, quotas, billing, and operations.
- Hosted provider and integration credential brokering.
- Rostrum Cloud microVM execution and fleet management.

Workflow packaging, installation, signing, distribution, marketplace behavior, and monetization remain deferred.

## 6. Finalized Rostrum state

Rostrum is complete for this plan when:

- humans and AI systems can create workflow JSON and verify it through the same CLI/API contract;
- teams can co-author drafts, use Git-based review where appropriate, compare revisions, and publish immutable versions;
- simulation behavior is declared per node and supported by a rich reusable mock library;
- clients and integrations invoke explicitly selected workflows with schema-validated inputs;
- model, deterministic, container-defined script, context, human, integration, and control nodes compose in one durable graph;
- the Model Provider Layer brokers model access separately from the read-only Context Layer;
- scripts own their runtime and dependencies through a Dockerfile, image, or equivalent runnable definition;
- runs survive client, worker, and daemon interruptions and expose artifacts, policy decisions, costs, and failures;
- the same workflow contracts run locally and self-hosted in Docker and in Rostrum Cloud microVMs;
- every showcase in this document passes without adding a domain-specific execution path.
