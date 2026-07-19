# Epic-05: Execution Targets and Sandboxing

Source PRD: [PRD-05](../prds/prd-05-execution-targets-and-sandboxing.md)  
Status: Draft

## Outcome

Run workflow work in explicit, isolated, reproducible environments selected by policy.

## Epics and tasks

### E-TARGET-01: Target contract

- [ ] Define target capabilities, isolation classes, lifecycle, and evidence schema.
- [ ] Define workspace snapshot, mount, image, environment, and resource configuration.
- [ ] Implement target admission and readiness checks.
- [ ] Implement target cleanup, expiration, and orphan recovery.
- [ ] Add lifecycle labels/metadata, reattach/inspection behavior, and orphan reaping for interrupted daemon processes.
- [ ] Add baseline Docker hardening: capability drop, no-new-privileges, process/resource limits, explicit network policy, and minimal mounts.
- [ ] Restrict credential/environment forwarding to explicit allowlists and reject arbitrary hardening overrides.
- [ ] Support per-workflow/task containers for parallel isolated work; make persistence explicit.
- [ ] Add target status and operator drain controls.

### E-TARGET-02: Docker targets

- [ ] Implement local Docker workspace target.
- [ ] Implement self-hosted Docker target configuration.
- [ ] Add source snapshot import and workspace initialization.
- [ ] Add branch creation, push-to-origin, and change handoff.
- [ ] Add workspace cache and environment fingerprint.
- [ ] Add target parity tests for core tools.

### E-TARGET-03: Rostrum Cloud microVM targets

- [ ] Prototype Rostrum Cloud microVM execution.
- [ ] Add image, workspace, artifact, and log transport.
- [ ] Add resource quotas and target expiration.
- [ ] Add target health and capacity signals to scheduling.

### E-TARGET-04: Environment promotion

- [ ] Define target/environment classes: local, preview, staging, production.
- [ ] Add environment-specific policy and approval checks.
- [ ] Define artifact promotion and provenance.
- [ ] Add deployment target adapter contract.

## SPIKEs

- [ ] S-TARGET-01 Rostrum Cloud microVM technology benchmark.
- [ ] S-TARGET-02 Workspace snapshot and transport design.
- [ ] S-TARGET-03 Network isolation and live dependency access.
- [ ] S-TARGET-04 Long-running process and service lifecycle.
- [ ] S-TARGET-05 Image provenance, cache, and vulnerability scanning.
- [ ] S-TARGET-06 Compare Hermes Agent Docker sandbox lifecycle and hardening patterns with Rostrum’s per-task workspace model.

## Exit criteria

The same reference workflow runs in a local/self-hosted Docker workspace and a Rostrum Cloud microVM, with visible target metadata, bounded resources, branch push/change handoff, and reliable artifact/log collection.
