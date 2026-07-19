# Rostrum documentation

This directory is organized to move from evidence, to product decisions, to implementation work.

## Document flow

1. **Research** establishes the market context, architectural patterns, and source material.
2. **Strategy** defines what Rostrum is, why it exists, and how the end-to-end product should work.
3. **PRDs** define use cases, requirements, product boundaries, and open decisions for each product area.
4. **Epics** break approved PRDs into implementation work, including SPIKEs where the design is not yet settled.

## Current documents

### Research

- [AI Workflow Engine Market Research - source PDF](research/source/AI%20Workflow%20Engine%20Market%20Research.pdf)
- [AI Workflow Engine Market Research - synthesis](research/ai-workflow-engine-market-research-synthesis.md)
- [Hermes Agent Docker sandbox notes](research/hermes-agent-docker-sandbox-notes.md)

### Strategy

- [Rostrum High-Level Build Blueprint](strategy/rostrum-high-level-build-blueprint.md)
- [Rostrum End-to-End Product Plan](strategy/rostrum-end-to-end-product-plan.md)

The end-to-end plan now treats workflows as the reusable unit, Context as a read-only pass-through layer, Docker as the local/self-hosted execution target, and microVMs as Rostrum Cloud infrastructure.

### Product requirements

- [PRD index](prds/README.md)

### Implementation planning

- [Epics and SPIKEs](epics/)

## How to use this documentation

The strategy blueprint is the discussion document for deciding the shape of Rostrum. Once the major boundaries are agreed, create one PRD per product area, link each PRD back to the relevant strategy sections, and then create epics under `docs/epics/` for the implementation work. Keep unresolved architecture questions as explicit SPIKEs instead of hiding them inside feature tasks.
