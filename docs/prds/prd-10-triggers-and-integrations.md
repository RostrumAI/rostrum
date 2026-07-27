# PRD-10: Triggers and Integrations

Status: Draft  
Strategic context: [Platform Product Plan](../strategy/rostrum-end-to-end-product-plan.md#2-what-we-are-building-and-why)<br>
Primary epic: [Integration epics](../epics/epic-09-integrations.md)

## Purpose

Connect Rostrum to systems that invoke workflows, provide context, and receive results. Integrations should translate external events into authenticated, durable workflow invocations with declared inputs and publish structured outcomes back through stable contracts.

## Users and use cases

- A pull request triggers review-only analysis.
- A CI failure triggers a fast-fix workflow.
- A monitoring alert triggers diagnosis and a staged repair plan.
- A Slack or Teams message is mapped by an explicitly configured workflow or decider workflow to a structured invocation.
- A scheduled job runs dependency updates or documentation maintenance.
- A repository event supplies source, diff, issue, and ownership context.
- A deployment workflow reports status back to the originating system.
- An operator retries or replays an event safely.

## Goals

- Make event-driven execution first-class.
- Normalize triggers without coupling workflows to vendor-specific payloads.
- Make webhook authentication, replay protection, rate limits, and failure handling reliable.
- Provide a small set of high-value reference integrations first.
- Keep integrations as adapters over the core API and tool contracts.

## Initial integration categories

| Category | First-pass examples | Rostrum behavior |
| --- | --- | --- |
| Source control | GitHub/GitLab-style repository and pull request | Context, trigger, diff, comment/status output |
| CI/CD | Build/test/deploy system | Failure context, rerun, status, artifact handoff |
| Observability | Error/alert platform | Incident context, diagnosis, staged remediation |
| Communication | Slack/Teams/email | Questions, notifications, status, bounded approvals |
| Planning | Issue/project tracker | Task sync, plan publication, dependency status |
| Cloud/runtime | Container/VM/deployment platform | Target provisioning, promotion, health status |

## Required features

### Must

- Signed inbound webhook validation and replay protection.
- Trigger registry mapping event types to explicitly selected workflows and input schemas.
- Idempotent event handling and deduplication.
- Normalized trigger envelope with source, actor, timestamp, payload reference, and correlation IDs.
- Outbound status, comment, artifact, and result publishing.
- Retry/backoff/dead-letter behavior for external systems.
- Per-integration credentials and scopes.
- Rate limits, permission checks, and audit records.
- Test harness with fixture payloads and mock external APIs.

### Should

- Event filtering and routing expressions.
- Human question/approval adapters for collaboration tools.
- Two-way task and status synchronization.
- Integration health and credential expiration views.
- User-configurable notification escalation.

### Could

- Generic event bus connector.
- Marketplace for community integrations.
- Browser or desktop notification adapters.

## Acceptance criteria

1. A duplicate external event cannot create duplicate work without an explicit rerun request.
2. A trigger can be traced from the source event to the Rostrum run and published result.
3. An integration failure does not erase or incorrectly fail the underlying workflow.
4. External approvals resolve the same durable decision record as web/TUI approvals.
5. A repository/CI fixture can exercise a complete reference workflow in tests.

## Open questions and SPIKEs

- First provider choices and connector licensing.
- Generic event envelope versus per-integration adapters.
- Safe two-way synchronization with issue trackers.
- Chat approval UX and authentication strength.
- Handling long-running external jobs and callbacks.

## Ownership boundary

Connector interfaces, fixtures, and baseline integrations should be open-source. Hosted event ingestion, managed OAuth, notifications, secret storage, and premium connectors may be hosted features.
