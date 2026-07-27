# Epic-00: Delivery Roadmap and Vertical Slices

Source PRDs: all PRDs  
Status: Draft

## Outcome

Establish a sequence that proves Rostrum’s core product claim early: a caller can invoke an explicitly defined workflow with structured inputs, execute it in an isolated environment, observe deterministic evidence, and receive an inspectable result.

## Milestones

### M0: Platform contract

- [ ] T-00-01 Agree on the initial workflow vocabulary.
- [ ] T-00-02 Choose the first implementation language/runtime boundaries.
- [ ] T-00-03 Define repository layout and public/private package boundaries.
- [ ] T-00-04 Establish event, artifact, tool, and run identity conventions.
- [ ] T-00-04a Establish context source, context policy, view, and provenance conventions.
- [ ] T-00-05 Create a generic workflow fixture, a script-pipeline fixture, and a smaller software-delivery reference fixture.
- [ ] T-00-05a Define the example workflow suite and completeness-bar fixtures.

### M1: Generic local execution slice

- [ ] T-00-06 Implement a minimal workflow definition and validator.
- [ ] T-00-07 Execute sequential nodes in a local Rostrum daemon behind the Control API.
- [ ] T-00-08 Add deterministic file, process, script, piping, and test tools.
- [ ] T-00-09 Run a declared script/tool workload in an isolated Docker workspace and collect bounded structured output.
- [ ] T-00-10 Persist run state and emit events.
- [ ] T-00-11 Expose start/status/control through a local API.
- [ ] T-00-12 Build the web control panel’s first graph/validation/simulation slice.
- [ ] T-00-13 Display and control runs in the optional TUI.

### M2: Durable composition and human control

- [ ] T-00-14 Add planning artifacts and approval gates.
- [ ] T-00-15 Add independent verification and bounded repair loops.
- [ ] T-00-16 Implement generic review, transform, approval, and verify/retry reference workflows.
- [ ] T-00-17 Add transfer-node trajectory checkpoints and optional prewalk-style configuration.
- [ ] T-00-18 Add typed output piping from scripts/tools into downstream nodes.
- [ ] T-00-19 Demonstrate disconnect/reconnect and restart recovery.

### M3: Authoring and integrations

- [ ] T-00-20 Add web run/project/artifact views.
- [ ] T-00-21 Add mobile-friendly approval flow.
- [ ] T-00-22 Add visual workflow authoring, simulation, and publication.
- [ ] T-00-23 Add generic event fixtures and one production connector.
- [ ] T-00-24 Add run reports, audit trail, and basic usage accounting.

### M4: First workflow collection

- [ ] T-00-25 Add the software-delivery workflow collection.
- [ ] T-00-26 Add staging deployment and live smoke/dependency workflows as collection capabilities.
- [ ] T-00-27 Run the secure note-taking reference fixture.
- [ ] T-00-27a Run at least one research/incident/synchronization workflow using the same core contracts.

### M5: Hosted execution

- [ ] T-00-28 Add Rostrum Cloud microVM target adapter and tenant boundary.
- [ ] T-00-29 Add credential brokering, quotas, and kill switches.
- [ ] T-00-30 Add hosted operations, billing, and retention controls.

## Cross-cutting SPIKEs

- [ ] S-00-01 Compare workflow runtime implementation strategies.
- [ ] S-00-02 Define the smallest useful local-to-cloud portability contract.
- [ ] S-00-03 Benchmark the first vertical slice on a realistic repository.
- [ ] S-00-04 Define what “secure note-taking app” means as a reference acceptance plan.
- [ ] S-00-05 Define the boundary between core workflow invocation and optional prompt-driven decider workflows.
- [ ] S-00-06 Benchmark trajectory-preserving transfer nodes and sandboxed script pipelines.

## Exit criteria

The roadmap is validated when the M2 slice can be demonstrated end to end by a person who did not build the runtime, using only the documented local setup, web control panel, and Control API; the TUI remains an optional operational surface.
