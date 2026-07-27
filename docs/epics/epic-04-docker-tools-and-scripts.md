# Epic-04: Docker Tools and Scripts

Milestone: M4
Source PRDs: [PRD-04](../prds/prd-04-deterministic-tools-and-policy.md), [PRD-05](../prds/prd-05-execution-targets-and-sandboxing.md)
Status: Draft

## Outcome

Workflow nodes can safely run built-in tools and author-supplied containerized scripts in Docker and bind captured results into later nodes.

## Tasks

### Docker target

- [ ] Implement provision, readiness, execute, collect, cancel, and cleanup lifecycle operations.
- [ ] Add baseline hardening, resource limits, explicit mounts, network policy, and credential allowlists.
- [ ] Add labels, expiration, orphan detection, and cleanup evidence.

### Tools and scripts

- [ ] Implement file, process, test, build, Git, and artifact primitives.
- [ ] Accept a pinned OCI image, Dockerfile/build context, or equivalent runnable definition.
- [ ] Deliver declared inputs and capture stdout, stderr, files, artifacts, exit status, and resource use.
- [ ] Apply author-defined downstream bindings and declared-schema validation.

### Policy and evidence

- [ ] Evaluate allow, deny, constrained-allow, and require-approval decisions before execution.
- [ ] Enforce output and time limits plus cancellation cleanup.
- [ ] Persist tool/script invocation and policy evidence.

## SPIKEs

- [ ] Compare Hermes Agent lifecycle and hardening patterns with Rostrum's per-task model.
- [ ] Define image build, cache, provenance, and admission behavior.
- [ ] Define safe network and credential injection boundaries.

## Exit criteria

A workflow runs a built-in tool and a container-defined script in Docker, blocks an unapproved capability, captures bounded evidence, and binds the declared result into a downstream node.
