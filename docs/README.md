# Rostrum documentation

This directory moves from evidence to product decisions and then to implementation work.

## Document flow

1. **Research** records market context, architectural patterns, and source material.
2. **Strategy** defines Rostrum, its purpose, and the shape of the product.
3. **Epics** define each delivery milestone, its requirements, its boundaries, and the decisions still needed.
4. **Decisions** record approved SPIKE outcomes that later implementation work depends on.
5. **Results** record spike proof-of-concept and verification outcomes.
6. **Tasks** contain the bounded implementation work and acceptance criteria for each Epic.

Files under `decisions/`, `results/`, and `tasks/` follow the same naming scheme: an epic folder (`epic-01/`) plus a file named `<epic>-<task>-<slug>.md`, so the folder and file name identify the exact epic task a decision or result belongs to.

## Current documents

### Research

- [AI Workflow Engine Market Research - source PDF](research/source/AI%20Workflow%20Engine%20Market%20Research.pdf)
- [AI Workflow Engine Market Research - synthesis](research/ai-workflow-engine-market-research-synthesis.md)
- [Hermes Agent Docker sandbox notes](research/hermes-agent-docker-sandbox-notes.md)
- [Prewalk-style model handoff notes](research/prewalk-model-handoff-notes.md)

### Strategy

- [Rostrum High-Level Build Blueprint](strategy/rostrum-high-level-build-blueprint.md)
- [Rostrum Platform Product Plan](strategy/rostrum-end-to-end-product-plan.md)

The product plan organizes Rostrum around delivery milestones and a showcase suite. It covers workflow JSON and collaborative authoring, durable execution, a separate Model Provider Layer and read-only Context Layer, Docker/self-hosted execution, and Rostrum Cloud microVMs.

### Implementation planning

- [Epic 01: Shape of a Workflow](epics/epic-01-shape-of-a-workflow.md)
- [Epic 02: Local Workflow Execution](epics/epic-02-local-workflow-execution.md)
- [Epic 03: Durable Runs and Human Control](epics/epic-03-durable-runs-and-human-control.md)

### Decisions

- [E1-S0: Implementation stack, Control API contract, and workflow persistence](decisions/epic-01/e1-s0-implementation-stack.md)

### Results

- [E1-S0: Proof-of-concept verification](results/epic-01/e1-s0-proof-of-concept.md)

## How to use this documentation

The strategy blueprint defines Rostrum's shape. The product plan orders delivery into milestones, with Milestone M1 mapping to Epic-01, M2 to Epic-02, and so on. Each Epic defines the product state, requirements, ordered work, and exit criteria for its milestone. Keep unresolved architecture questions as explicit SPIKEs inside the Epic that needs the decision, and keep task-level acceptance criteria in the linked task documents.
