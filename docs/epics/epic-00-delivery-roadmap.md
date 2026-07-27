# Epic-00: Delivery Milestone Coordination

Source: [Platform Product Plan delivery milestones](../strategy/rostrum-end-to-end-product-plan.md#3-delivery-milestones)
Status: Draft

## Outcome

Keep Milestones M1–M13 and Epics 01–13 aligned one-to-one. A milestone closes only when its Epic exit demonstration works through public contracts and produces inspectable evidence.

## Delivery sequence

| Milestone | Epic | Product state |
| --- | --- | --- |
| M1 | [Epic-01](epic-01-trusted-workflow-json.md) | Workflow JSON can be trusted |
| M2 | [Epic-02](epic-02-local-workflow-execution.md) | A workflow can execute locally |
| M3 | [Epic-03](epic-03-durable-runs-and-human-control.md) | A run can survive, wait, and be inspected |
| M4 | [Epic-04](epic-04-docker-tools-and-scripts.md) | A workflow can safely run tools and scripts |
| M5 | [Epic-05](epic-05-model-providers-and-nodes.md) | Models can be used in workflows |
| M6 | [Epic-06](epic-06-project-context.md) | Project context can be used in workflows |
| M7 | [Epic-07](epic-07-workflow-simulation.md) | Workflows can be simulated |
| M8 | [Epic-08](epic-08-control-applications.md) | Workflows can be authored and operated visually |
| M9 | [Epic-09](epic-09-sdk.md) | Applications can embed Rostrum |
| M10 | [Epic-10](epic-10-integrations.md) | External systems can participate |
| M11 | [Epic-11](epic-11-collaborative-authoring.md) | Teams can co-author workflows |
| M12 | [Epic-12](epic-12-showcase-suite.md) | The showcase suite proves product breadth |
| M13 | [Epic-13](epic-13-rostrum-cloud.md) | Rostrum can be operated as Cloud |

## Coordination tasks

- [ ] Require each Epic to link its contributing PRDs and corresponding milestone.
- [ ] Define a versioned evidence bundle for every milestone exit demonstration.
- [ ] Run compatibility, security, failure-injection, and documentation checks inside each Epic rather than deferring quality to a final Epic.
- [ ] Prevent later Epics from silently changing an earlier public contract without a recorded compatibility decision.
- [ ] Track cross-Epic dependencies and block milestone closure on unresolved required SPIKEs.
- [ ] Maintain local/self-hosted conformance through M12 and local-to-Cloud conformance in M13.

## Cross-cutting SPIKEs

- [ ] Define milestone evidence and release-gate automation.
- [ ] Define public contract compatibility and deprecation policy.
- [ ] Define the smallest useful local-to-Cloud portability contract.
- [ ] Establish performance, cost, security, and reliability budgets by milestone.

## Exit criteria

Epic-00 closes when every numbered Epic passes its matching milestone demonstration, all showcases pass, and the finalized Rostrum state can be reproduced from documented fixtures against local, self-hosted, and Cloud deployments.
