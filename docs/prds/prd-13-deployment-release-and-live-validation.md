# PRD-13: Deployment, Release, and Live Validation

Status: Draft  
Strategic context: [End-to-End Product Plan](../strategy/rostrum-end-to-end-product-plan.md#4-the-end-to-end-journey)  
Primary epic: [Deployment and live validation epics](../epics/epic-13-deployment-and-live-validation.md)

## Purpose

Make deployment a governed workflow with staged promotion, environment-specific policies, observable health checks, safe live dependency tests, and explicit rollback or escalation behavior.

## Users and use cases

- A developer deploys a feature branch to a preview environment.
- A team promotes a verified artifact to staging.
- A release owner approves production deployment after reviewing evidence.
- A migration workflow validates data changes before applying them.
- A live-validation workflow tests the deployed application against real or controlled dependencies.
- An operator pauses promotion when health checks fail.
- A workflow rolls back, forwards-fixes, or escalates when a release is unhealthy.
- A product owner performs a bounded user-acceptance check before release.

## Goals

- Make environment promotion and deployment evidence first-class artifacts.
- Keep build artifact identity stable across environments.
- Ensure production and live dependency access use stronger policy than local work.
- Make checks deterministic where possible and explicit about uncertainty where not.
- Provide safe failure, rollback, and operator-intervention paths.

## Non-goals

- Replacing every existing deployment platform.
- Promising universal rollback for irreversible data changes.
- Allowing an agent to invent production access or bypass release policy.

## Deployment lifecycle

1. Resolve environment and target policy.
2. Validate artifact provenance, dependencies, configuration, and required approvals.
3. Validate migration/data-change plan and rollback/forward-fix strategy.
4. Deploy to preview or staging.
5. Run deterministic health, smoke, compatibility, security, and performance checks.
6. Run live dependency checks using declared data, credentials, and cleanup behavior.
7. Review evidence and promote, hold, rollback, or escalate.
8. Observe post-deployment health and publish the release report.

## Required features

### Must

- Environment model with preview, staging, production, and custom target classes.
- Deployment adapter contract for apply, status, health, rollback, and logs.
- Immutable artifact identity and provenance.
- Environment-specific policies and approval gates.
- Configuration and secret validation without exposing secret values.
- Migration/data-change plan and safety checks.
- Deterministic smoke, health, contract, and compatibility checks.
- Live dependency test declaration: dependencies, data created, credentials, network, expected outcomes, cleanup, and allowed environments.
- Rollback, forward-fix, halt, and manual intervention branches.
- Release record linking artifact, approvals, checks, deployment, health, and outcome.
- Post-release monitoring handoff.

### Should

- Preview environment per run or change set.
- Progressive/canary promotion.
- Automatic test-data lifecycle and cleanup.
- Deployment diff and configuration drift detection.
- User-acceptance task with evidence attachment.
- Release windows and change freeze policy.

### Could

- Traffic shadowing.
- Synthetic monitoring generated from product requirements.
- Automated rollback based on health thresholds.

## Acceptance criteria

1. A production deployment cannot occur without the declared approvals and evidence.
2. The deployed artifact can be traced back to the run, task graph, commit, and checks that produced it.
3. Live dependency tests state what they may change and how they clean up.
4. A failed health check stops or routes through a declared response; it does not silently pass.
5. A release report clearly states what was deployed, where, what was checked, what failed, and what action remains.

## Open questions and SPIKEs

- First deployment providers and abstraction depth.
- Migration rollback versus forward-fix policy.
- Safe production test-data strategies.
- Canary/blue-green support in the first hosted release.
- How human user-acceptance evidence becomes a durable workflow result.

## Ownership boundary

Deployment contracts, local adapters, reference checks, and self-hosted workflows should be open-source. Managed preview environments, hosted deployment orchestration, production connectors, and enterprise release policy may be hosted or separately licensed.

