# Epic-04: Deterministic Tools and Policy

Source PRD: [PRD-04](../prds/prd-04-deterministic-tools-and-policy.md)  
Status: Draft

## Outcome

Provide deterministic, auditable tool execution with explicit side-effect and approval policy.

## Epics and tasks

### E-TOOLS-01: Tool contract and registry

- [ ] Define tool manifest, capability, risk, input, output, and evidence schemas.
- [ ] Implement tool registration and version resolution.
- [ ] Define tool execution request/result/error contracts.
- [ ] Add local tool discovery and hosted registry adapter.
- [ ] Add tool compatibility and deprecation metadata.

### E-TOOLS-02: Core software tools

- [ ] Implement safe file read/write/list/search tools.
- [ ] Implement Git status/diff/branch/commit/push tools.
- [ ] Implement process/test/build/lint/type-check tools.
- [ ] Implement artifact capture and publishing tools.
- [ ] Implement wait, approval, notification, and branch-decision tools.

### E-TOOLS-03: Policy evaluation

- [ ] Define policy inputs: user, project, workflow, node, target, tool, data, environment, and budget.
- [ ] Implement allow, deny, require-approval, and constrained-allow decisions.
- [ ] Add filesystem, process, network, credential, and resource policies.
- [ ] Add policy simulation and test fixtures.
- [ ] Persist policy decisions and reasons.

### E-TOOLS-04: Reliable execution

- [ ] Add timeout, cancellation, output limits, and cleanup.
- [ ] Add structured exit/result parsing.
- [ ] Add dry-run and tool simulation configuration.
- [ ] Add retry/idempotency metadata for side effects.
- [ ] Add tool invocation audit records.

## SPIKEs

- [ ] S-TOOLS-01 Policy language and evaluation engine.
- [ ] S-TOOLS-02 Shell compatibility and safe command execution.
- [ ] S-TOOLS-03 Network proxy/egress enforcement.
- [ ] S-TOOLS-04 Credential injection and secret redaction.
- [ ] S-TOOLS-05 Compensation/rollback patterns for external writes.

## Exit criteria

A guided-build workflow can modify a Docker workspace, create and push a branch, run tests, collect structured evidence, and block an unapproved side effect through the same tool/policy path locally and in a test sandbox.
