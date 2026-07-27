# Epic-11: Collaborative Authoring

Milestone: M11
Source PRDs: [PRD-15](../prds/prd-15-workflow-authoring-and-simulation.md), [PRD-09](../prds/prd-09-web-control-panel-and-mobile.md)
Status: Draft

## Outcome

Teams can co-author workflow JSON through revisioned Rostrum drafts or Git review without silent overwrites or ambiguity about which revision was approved.

## Tasks

### Revision model

- [ ] Implement immutable draft revisions, parent relationships, authorship, timestamps, and optimistic concurrency.
- [ ] Implement fork, compare, conflict, merge, comment, review, request-changes, and publication records.
- [ ] Attach comments and decisions to stable workflow, node, edge, policy, or revision identities.

### Semantic collaboration

- [ ] Implement semantic diff independent of JSON ordering.
- [ ] Implement three-way merge and explicit conflict resolution for graph changes.
- [ ] Add review ownership, mentions, notifications, and decision history.
- [ ] Add presence and collaborative cursors after the revision model is stable.

### Git bridge

- [ ] Export and import workflow JSON plus referenced mock fixtures.
- [ ] Preserve commit, branch, pull-request, and reviewer provenance.
- [ ] Reconcile Git changes with Rostrum draft revisions through semantic comparison.

## SPIKEs

- [ ] Select draft storage and real-time collaboration protocols.
- [ ] Define stable identity through concurrent visual and Git edits.
- [ ] Prototype semantic merge for node deletion, rewiring, and policy changes.

## Exit criteria

Two users can edit from the same parent without losing changes, resolve a semantic conflict, review the result in Rostrum or Git, and publish the exact approved revision and digest.
