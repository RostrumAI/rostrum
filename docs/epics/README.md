# Rostrum Epics and SPIKEs

The [Platform Product Plan](../strategy/rostrum-end-to-end-product-plan.md#3-delivery-milestones) defines thirteen priority-ordered delivery milestones. Milestone M1 maps to Epic-01, M2 to Epic-02, and so on. PRDs describe product requirements; Epics combine the required parts of those PRDs into a demonstrable increment.

Use SPIKEs for questions that require investigation, prototypes, benchmarks, or architectural decisions. Each SPIKE should end with evidence, a decision, and follow-up work.

## Epic index

- [Epic-00: Delivery milestone coordination](epic-00-delivery-roadmap.md)
- [Epic-01: Trusted workflow JSON](epic-01-trusted-workflow-json.md)
- [Epic-02: Local workflow execution](epic-02-local-workflow-execution.md)
- [Epic-03: Durable runs and human control](epic-03-durable-runs-and-human-control.md)
- [Epic-04: Docker tools and scripts](epic-04-docker-tools-and-scripts.md)
- [Epic-05: Model providers and model nodes](epic-05-model-providers-and-nodes.md)
- [Epic-06: Project context](epic-06-project-context.md)
- [Epic-07: Workflow simulation](epic-07-workflow-simulation.md)
- [Epic-08: Control applications](epic-08-control-applications.md)
- [Epic-09: SDK](epic-09-sdk.md)
- [Epic-10: Integrations](epic-10-integrations.md)
- [Epic-11: Collaborative authoring](epic-11-collaborative-authoring.md)
- [Epic-12: Showcase suite](epic-12-showcase-suite.md)
- [Epic-13: Rostrum Cloud](epic-13-rostrum-cloud.md)

## Sequence

Trusted workflow JSON → local execution → durable runs/human control → Docker tools/scripts → models → project context → simulation → control applications → SDK → integrations → collaboration → showcase suite → Rostrum Cloud.

Quality, security, documentation, compatibility, and failure testing belong in the Epic that introduces the relevant behavior. They are not deferred to a final cleanup Epic.
