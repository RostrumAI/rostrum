# Rostrum documentation

This directory is organized to move from evidence, to product decisions, to implementation work.

## Document flow

1. **Research** establishes the market context, architectural patterns, and source material.
2. **Strategy** defines what Rostrum is, why it exists, and how the end-to-end product should work.
3. **PRDs** define use cases, requirements, product boundaries, and open decisions for each product area.
4. **Epics** combine the required parts of the PRDs into priority-ordered, demonstrable delivery milestones, including SPIKEs where the design is not yet settled.

## Current documents

### Research

- [AI Workflow Engine Market Research - source PDF](research/source/AI%20Workflow%20Engine%20Market%20Research.pdf)
- [AI Workflow Engine Market Research - synthesis](research/ai-workflow-engine-market-research-synthesis.md)
- [Hermes Agent Docker sandbox notes](research/hermes-agent-docker-sandbox-notes.md)
- [Prewalk-style model handoff notes](research/prewalk-model-handoff-notes.md)

### Strategy

- [Rostrum High-Level Build Blueprint](strategy/rostrum-high-level-build-blueprint.md)
- [Rostrum Platform Product Plan](strategy/rostrum-end-to-end-product-plan.md)

The product plan now organizes Rostrum around delivery milestones and a showcase suite: workflow JSON and collaborative authoring, durable execution, a separate Model Provider Layer and read-only Context Layer, Docker/self-hosted execution, and Rostrum Cloud microVMs.

### Product requirements

- [PRD index](prds/README.md)

### Implementation planning

- [Epics and SPIKEs](epics/)

## How to use this documentation

The strategy blueprint defines Rostrum's shape. PRDs describe requirements by product area. The product plan then orders those requirements into milestones, with Milestone M1 mapping to Epic-01, M2 to Epic-02, and so on. Keep unresolved architecture questions as explicit SPIKEs inside the Epic that needs the decision.
