# Epic-00: Delivery Roadmap and Vertical Slices

Source PRDs: all PRDs  
Status: Draft

## Outcome

Establish a sequence that proves Rostrum’s core product claim early: a user can move from a software goal to an approved plan, isolated implementation, deterministic verification, and inspectable result.

## Milestones

### M0: Platform contract

- [ ] T-00-01 Agree on the initial workflow vocabulary.
- [ ] T-00-02 Choose the first implementation language/runtime boundaries.
- [ ] T-00-03 Define repository layout and public/private package boundaries.
- [ ] T-00-04 Establish event, artifact, tool, and run identity conventions.
- [ ] T-00-04a Establish context source, context policy, view, and provenance conventions.
- [ ] T-00-05 Create a reference note-taking app fixture and a smaller test fixture.

### M1: Local execution slice

- [ ] T-00-06 Implement a minimal workflow definition and validator.
- [ ] T-00-07 Execute sequential nodes in a local daemon.
- [ ] T-00-08 Add deterministic file, Git, process, and test tools.
- [ ] T-00-09 Run work in an isolated Docker workspace, create a branch, push it to an origin, and collect a diff.
- [ ] T-00-10 Persist run state and emit events.
- [ ] T-00-11 Expose start/status/control through a local API.
- [ ] T-00-12 Display and control runs in the TUI.

### M2: Human-gated guided build

- [ ] T-00-13 Add planning artifacts and approval gates.
- [ ] T-00-14 Add independent verification and bounded repair loops.
- [ ] T-00-15 Implement review-only, planning, and guided-build reference workflows.
- [ ] T-00-16 Demonstrate disconnect/reconnect and restart recovery.

### M3: Shared control and triggers

- [ ] T-00-17 Add web run/project/artifact views.
- [ ] T-00-18 Add mobile-friendly approval flow.
- [ ] T-00-19 Add repository and CI event fixtures and one production connector.
- [ ] T-00-20 Add run reports, audit trail, and basic usage accounting.

### M4: Deployment and hosted execution

- [ ] T-00-21 Add staging deployment and live smoke/dependency test workflow.
- [ ] T-00-22 Add Rostrum Cloud microVM target adapter and tenant boundary.
- [ ] T-00-23 Add credential brokering, quotas, and kill switches.
- [ ] T-00-24 Add hosted operations, billing, and retention controls.

## Cross-cutting SPIKEs

- [ ] S-00-01 Compare workflow runtime implementation strategies.
- [ ] S-00-02 Define the smallest useful local-to-cloud portability contract.
- [ ] S-00-03 Benchmark the first vertical slice on a realistic repository.
- [ ] S-00-04 Define what “secure note-taking app” means as a reference acceptance plan.

## Exit criteria

The roadmap is validated when the M2 slice can be demonstrated end to end by a person who did not build the runtime, using only the documented local setup and TUI/API.
