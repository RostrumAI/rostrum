# PRD-11: Software Delivery Workflow Pack

Status: Draft  
Strategic context: [End-to-End Product Plan](../strategy/rostrum-end-to-end-product-plan.md#7-reference-software-delivery-workflows)  
Primary epic: [Software delivery epics](../epics/epic-10-software-delivery.md)

## Purpose

Provide the first domain-specific set of workflows, nodes, artifacts, and policies that can take a software idea from discovery through deployment and live validation.

This PRD is where Rostrum’s general workflow platform becomes useful to a person who asks it to build an application. It should be implemented as a domain pack over the general runtime wherever possible.

## Users and use cases

### Product discovery

Turn a plain-language product intent into requirements, personas, user journeys, non-goals, assumptions, and prioritized questions.

### Architecture and security planning

Produce component boundaries, APIs, data models, platform choices, threat model, privacy considerations, dependency choices, and deployment architecture.

### Task graph creation

Turn approved plans into dependency-aware tasks with acceptance criteria, likely owner/worker type, required context, and verification strategy.

### Implementation

Assign isolated tasks to workers that modify code, tests, configuration, documentation, and infrastructure according to policy.

### Verification

Run deterministic tests, type checks, builds, linters, security scans, license checks, accessibility checks, device/browser checks, and review workflows.

### Release and live validation

Build and promote artifacts, apply migrations, deploy to staging or production, exercise real dependencies safely, observe health, and roll back or escalate.

### Maintenance

Respond to CI failures, dependency alerts, incidents, flaky tests, documentation drift, and routine upgrades.

## Product principles

- Planning artifacts are contracts, not disposable chat output.
- Product decisions and security decisions are distinct but linked.
- Implementation cannot outrun approved scope and policy.
- Every task has an executable or reviewable completion condition.
- Deterministic checks outrank agent confidence.
- Deployment is a graph with gates, not a privileged shell command.
- Live testing is explicit about data, credentials, dependencies, and rollback.

## Required features

### Must

- Product discovery workflow with prioritized clarification questions.
- Plan artifact set covering product, architecture, security, testing, deployment, and operations.
- Human review and approval of plan revisions.
- Task graph builder with dependency validation and acceptance criteria.
- Repository source snapshots, isolated Docker/microVM workspaces, branch creation, and push-to-origin change handoff.
- Implementation worker workflow with structured task contracts.
- Independent verification workflow.
- Bounded verify-fix loop with escalation.
- Build/test/lint/type/security/license/accessibility check nodes.
- Staged deployment and rollback/stop gates.
- Live smoke and dependency checks with data-safety declarations.
- Final delivery report linking goals, decisions, tasks, changes, tests, deployments, and known risks.

### Should

- Platform-aware templates for web, mobile, desktop, backend, and shared libraries.
- Cross-repository task coordination.
- Generated issue tracker tasks and pull requests.
- Preview environments per run or feature branch.
- Contract tests for APIs and generated clients.
- Dependency update and vulnerability remediation workflows.
- Performance, compatibility, and accessibility test packs.
- Post-release monitoring and incident handoff.

### Could

- Automatic product discovery from user research artifacts.
- Multi-agent architecture review with consensus gates.
- Visual app preview and user acceptance testing.
- Generalized non-software domain packs.

## Reference workflows

1. **Discovery:** intent → context → questions → product brief.
2. **Plan:** brief → requirements → architecture/security/test/deploy plan → approval.
3. **Guided build:** approved plan → task graph → implementation → verify/fix → reviewable change.
4. **Fast fix:** failure/alert → triage → narrow patch → deterministic checks → summary.
5. **Review-only:** diff/repository → context → checklist → findings.
6. **Release:** approved artifact → policy → staging deploy → live checks → promotion/rollback.
7. **Autonomous project:** plan → task graph → worker fleet → integration → release gates.

## Acceptance criteria

1. A single product intent can produce a linked set of reviewable plan artifacts.
2. The workflow asks high-impact questions before it commits to irreversible architecture or security assumptions.
3. An approved plan can produce tasks with machine-readable acceptance criteria.
4. A task cannot be marked complete solely by an agent’s assertion when deterministic checks are available.
5. Failed checks produce targeted evidence and bounded repair attempts.
6. Deployment and live testing require environment-specific policy and produce an auditable result.
7. The final report makes it possible to answer what was requested, what was decided, what changed, what passed, and what remains risky.

## Open questions and SPIKEs

- First supported application shapes and platform matrix.
- How requirements map to tests and code changes.
- Best representation for task graphs and acceptance criteria.
- Preview environment provisioning and cost controls.
- Safe live dependency test data and cleanup.
- Deployment provider abstraction and rollback semantics.
- How user acceptance testing is represented in the workflow.

## Ownership boundary

Reference software-development workflows, nodes, templates, and local check packs should be open-source. Hosted preview environments, managed deployments, proprietary platform integrations, and enterprise compliance packs may be hosted or separately licensed.
