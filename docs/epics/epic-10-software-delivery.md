# Epic-10: Software Delivery Workflow Collection

Source PRD: [PRD-11](../prds/prd-11-software-delivery-workflows.md)  
Status: Draft

## Outcome

Demonstrate the end-to-end Rostrum experience for software development, from an idea to verified and live-tested software.

## Epics and tasks

### E-SD-01: Discovery and decision workflows

- [ ] Define product brief, assumption, question, answer, and decision artifacts.
- [ ] Implement context gathering from repository/project history through the Context Layer.
- [ ] Implement prioritized clarification-question generation.
- [ ] Implement multi-channel question/feedback routing.
- [ ] Implement decision conflict, expiry, and revision behavior.

### E-SD-02: Plan artifact set

- [ ] Define product requirements artifact schema.
- [ ] Define architecture and API/data model artifact schema.
- [ ] Define security/threat model artifact schema.
- [ ] Define test strategy and acceptance criteria artifact schema.
- [ ] Define deployment/operations/rollback plan schema.
- [ ] Add plan consistency checks and approval gate.

### E-SD-03: Task graph and implementation

- [ ] Generate dependency-aware tasks from approved plan.
- [ ] Add task contracts, context manifests, and acceptance checks.
- [ ] Add context-view requirements to task manifests and enforce source scope.
- [ ] Implement Docker/microVM workspace creation, branch creation, and task isolation.
- [ ] Push task branches to the configured origin and record the change handoff.
- [ ] Implement worker assignment and task result handoff.
- [ ] Add optional transfer-node exploration-to-execution model transfer with context pruning.
- [ ] Add sandboxed repository-analysis and verification scripts with structured output piping.
- [ ] Implement pull-request/change-set generation.

### E-SD-04: Deterministic verification

- [ ] Add test/build/lint/type-check workflow composition.
- [ ] Add security, dependency, license, and secret checks.
- [ ] Add browser/device/accessibility check adapters.
- [ ] Add independent review and verifier roles.
- [ ] Add bounded repair task generation.
- [ ] Add escalation after budget/attempt exhaustion.

### E-SD-05: Deploy and live validation

- [ ] Define environment and deployment artifact contracts.
- [ ] Implement staging/preview deployment workflow.
- [ ] Implement migration/configuration safety checks.
- [ ] Implement health, smoke, and live dependency test nodes.
- [ ] Implement rollback/forward-fix decision paths.
- [ ] Produce release and live-validation report.

### E-SD-06: Reference application fixture

- [ ] Define secure note-taking app product brief and threat model.
- [ ] Create a small multi-platform reference repository or fixture.
- [ ] Encode platform, authentication, sync, encryption, and deployment acceptance checks.
- [ ] Run the full workflow repeatedly to identify reliability gaps.

## SPIKEs

- [ ] S-SD-01 Requirements-to-tests traceability approach.
- [ ] S-SD-02 Platform matrix for web/mobile/desktop reference projects.
- [ ] S-SD-03 Preview environment provisioning and cost model.
- [ ] S-SD-04 Safe live dependency test data and cleanup.
- [ ] S-SD-05 Deployment provider abstraction and rollback semantics.
- [ ] S-SD-06 Human acceptance testing as a workflow node.

## Exit criteria

A caller can invoke the software-delivery pack with a bounded product brief, review a generated plan, approve it, observe implementation and deterministic verification, and receive a deployment/live-validation report for a non-production target.
