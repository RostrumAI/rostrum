# PRD-12: Hosted Governance, Identity, and Usage

Status: Draft  
Strategic context: [End-to-End Product Plan](../strategy/rostrum-end-to-end-product-plan.md#9-open-source-and-hosted-product)  
Primary epic: [Hosted governance epics](../epics/epic-11-hosted-governance.md)

## Purpose

Provide the hosted-service capabilities required to run autonomous workflows safely across organizations, users, projects, environments, and tenant boundaries. The core daemon, Control API, clients, Context Layer, Docker execution, authoring, and simulation remain self-hostable; this PRD covers managed hosted operations and Rostrum Cloud microVM execution.

## Users and use cases

- An organization creates teams, projects, roles, and policies.
- A user signs in and approves an action with an auditable identity.
- A run receives an ephemeral identity and scoped integration credentials.
- A Rostrum Cloud microVM executes untrusted code without exposing the control plane.
- An administrator configures quotas, budgets, retention, and kill switches.
- A finance owner sees usage and receives invoices or credit alerts.
- A security reviewer audits access, policy decisions, and production changes.
- Rostrum operates a fleet across failures, upgrades, and capacity constraints.

## Goals

- Enforce tenant isolation and least privilege.
- Make hosted execution auditable and cost-controlled.
- Keep cloud services replaceable behind open execution and control contracts.
- Support organization-level policy and environment governance.
- Provide operational tools for safe fleet management.

## Required features

### Must

- Organization, team, project, workspace, environment, and role model.
- Authentication, session management, and authorization.
- Service identities and ephemeral run identities.
- Scoped credential brokering and secret injection.
- Tenant-isolated state, events, artifacts, logs, and execution.
- Policy distribution and versioning.
- Quotas, budgets, rate limits, kill switches, and spend alerts.
- Usage events for model, node, runtime, storage, network, and integration consumption.
- Audit logs for authentication, policy, side effects, decisions, and administration.
- Hosted runtime admission, scheduling, health, draining, and cleanup.
- Rostrum Cloud microVM execution; self-hosted deployments remain Docker-only.
- Retention, export, deletion, and data residency controls where applicable.

### Should

- SSO, SCIM, and enterprise identity providers.
- Customer-managed keys or encryption controls.
- Private networking and customer-managed execution targets.
- Usage-based billing and credit systems.
- Security posture dashboards and anomaly detection.
- Approval policies requiring step-up authentication or dual control.

### Could

- Cross-region disaster recovery.
- Confidential computing.
- Marketplace and revenue sharing for workflows/integrations.
- Policy simulation across historical runs.

## Acceptance criteria

1. A user cannot read or control another organization’s state, artifacts, credentials, or runs.
2. A model or worker never receives a long-lived credential that grants broader access than its node requires.
3. An administrator can stop a run and prevent new work from starting within a defined bound.
4. Usage can be attributed to organization, project, run, node, model, target, and integration.
5. Hosted execution failure does not corrupt the durable control-plane record.
6. Every privileged or side-effecting action has an auditable identity and policy decision.

## Open questions and SPIKEs

- Identity provider and authorization model.
- Tenant isolation strategy for state, eventing, artifacts, and sandboxes.
- Credential broker architecture and secret rotation.
- Metering granularity and billing provider.
- Data residency and model-provider routing.
- Minimum hosted service that is commercially viable.

## Ownership boundary

Managed multi-tenancy, credential brokering, hosted execution, operational fleet services, billing, and enterprise administration are hosted capabilities. The primary functional hosted differentiator is Rostrum Cloud microVM execution. Public contracts, local Docker implementations, the daemon, Control API, clients, Context Layer, authoring, simulation, and self-hosting documentation should remain open.
