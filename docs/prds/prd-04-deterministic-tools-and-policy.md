# PRD-04: Deterministic Tools and Policy Gates

Status: Draft  
Strategic context: [End-to-End Product Plan](../strategy/rostrum-end-to-end-product-plan.md#10-trust-and-safety-posture)  
Primary epic: [Tools and policy epics](../epics/epic-04-tools-and-policy.md)

## Purpose

Make literal operations safe, observable, repeatable, and composable in workflows. Deterministic nodes should provide the evidence that reasoning nodes use, while policy gates prevent model output from expanding its authority.

## Users and use cases

- A workflow reads repository context under a defined path and size policy.
- An implementation worker edits files inside an isolated Docker or microVM workspace and pushes a branch to the configured origin.
- A verifier runs tests, builds, linters, type checks, and security scans.
- A deployment node promotes a known artifact to a permitted environment.
- An operator approves a network call or destructive migration.
- A tool author publishes a reusable command or integration node.
- A security reviewer audits all side effects performed by a run.

## Goals

- Provide a common tool contract for inputs, outputs, side effects, errors, and evidence.
- Enforce policy before execution, not after a model has already acted.
- Make tool results structured and reproducible where possible.
- Support local and hosted execution through the same tool definitions.
- Make approvals, credentials, filesystem, network, and resource controls explicit.

## Non-goals

- Guaranteeing that a command itself is safe in all possible environments.
- Replacing operating-system isolation or sandboxing.
- Supporting arbitrary unrestricted shell access in the hosted service.

## Required features

### Must

- Tool manifest: name, version, inputs, outputs, side effects, required capabilities, runtime, timeout, and risk class.
- Built-in file, Git branch/commit/push, process, test, build, artifact, wait, approval, and notification primitives.
- Command allowlists/denylists and argument validation.
- Filesystem roots, read/write/delete policies, and symlink/path traversal controls.
- Network egress policy with host, port, method, and data-classification controls.
- Credential injection through scoped, ephemeral handles rather than model-visible static secrets.
- Environment and resource limits: CPU, memory, disk, process count, time, and output size.
- Approval requirements based on tool, target, environment, data, and risk.
- Structured result containing status, exit code, stdout/stderr references, evidence, and metadata.
- Cancellation and timeout handling with cleanup behavior.
- Audit record for every invocation and policy decision.

### Should

- Tool simulation and dry-run configuration.
- Policy-as-code with test fixtures.
- Reproducible tool environments and pinned versions.
- Signed tool packages and trust levels.
- Compensation or rollback hooks for selected side effects.
- Integration tools that use the same policy path as local commands.

### Could

- Static risk scoring from tool graphs.
- Sandboxed browser or UI tools.
- Policy suggestions based on observed run behavior.

## Acceptance criteria

1. A model cannot execute a command outside the node’s declared tool and policy boundary.
2. A blocked action returns an inspectable policy decision rather than an opaque error.
3. A test runner returns machine-readable results that can drive graph branching.
4. A tool can require human approval without implementing approval logic itself.
5. The audit record identifies the run, node, tool version, runtime, identity, policy, and outcome.
6. The same tool definition can run against a Docker workspace and a hosted microVM with target-specific enforcement.

## Open questions and SPIKEs

- Policy language and evaluation engine.
- How much shell compatibility is needed for local development.
- Safe handling of generated scripts and child processes.
- Network proxy versus direct egress controls.
- Compensation model for deployments, migrations, and external writes.

## Ownership boundary

Tool contracts, reference tools, policy interfaces, and local policy execution should be open-source. Managed secret stores, enterprise policy distribution, hosted egress controls, and proprietary security operations may be hosted capabilities.
