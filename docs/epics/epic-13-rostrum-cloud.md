# Epic-13: Rostrum Cloud

Milestone: M13
Source PRDs: [PRD-12](../prds/prd-12-hosted-governance-identity-and-usage.md), [PRD-05](../prds/prd-05-execution-targets-and-sandboxing.md)
Status: Draft

## Outcome

The same workflow JSON, Control API, clients, SDK, and execution contracts operate as a managed multi-tenant service with microVM isolation.

## Tasks

### Hosted control plane

- [ ] Implement tenant, organization, team, project, role, membership, and authorization boundaries.
- [ ] Add SSO-ready identity, audit, managed retention, quota, budget, kill-switch, metering, and billing contracts.
- [ ] Add hosted provider, context-source, and integration credential brokering.

### MicroVM execution

- [ ] Implement provision, image/workspace transport, execute, collect, cancel, expiration, cleanup, and capacity signals.
- [ ] Enforce tenant, network, credential, resource, and artifact isolation.
- [ ] Add fleet health, draining, upgrades, orphan detection, and incident controls.

### Cloud conformance

- [ ] Run client, SDK, workflow, event, artifact, policy, and target contract suites against Cloud.
- [ ] Test tenant escape, credential leakage, egress, resource exhaustion, and billing attribution.
- [ ] Re-run applicable showcases and compare public contracts and workflow digests with self-hosted Docker.

## SPIKEs

- [ ] Select the microVM and fleet architecture.
- [ ] Define regional, residency, and provider-routing boundaries.
- [ ] Define the minimum hosted operations and billing release.

## Exit criteria

Two isolated tenants run the same published workflow through Rostrum Cloud microVMs; cross-tenant access is denied, usage is attributable, and applicable showcases preserve their workflow and public contract semantics.
