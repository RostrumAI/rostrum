# PRD-14: Context Layer

Status: Draft  
Strategic context: [High-Level Build Blueprint](../strategy/rostrum-high-level-build-blueprint.md#44-context-layer)  
Delivery Epic: [Epic-06](../epics/epic-06-project-context.md)

## Purpose

Provide read-only, policy-controlled access to the information an agent needs without exposing source-system credentials or turning Rostrum into a mandatory data warehouse.

The context layer should be as pass-through as possible: fetch only what a node is permitted to see, filter and redact it, deliver it to the node, and avoid persisting source content by default.

## Users and use cases

### Project owner or administrator

- Connect Slack, Discord, repositories, issue trackers, documentation sites, incident systems, and other approved sources.
- Define which projects, workflows, nodes, and data scopes may use each source.
- Prove that message/document bodies are not retained by default.
- Revoke or rotate a source connection without changing workflow definitions.

### Workflow author

- Declare the context sources and selectors needed by a workflow or node.
- Ask for a specific channel, repository path, documentation collection, issue, time range, or project scope.
- Require redaction, classification, freshness, and source provenance.

### Agent node

- Receive a context view or bundle containing only permitted content.
- See provenance and freshness metadata without receiving source credentials.
- Ask for additional context only through the workflow/context contract.

### Security or compliance reviewer

- Review context policies, source scopes, retention behavior, and access audit.
- Verify that a node cannot directly call a connected source outside the broker.

## Goals

- Make context access explicit in workflow and node contracts.
- Keep external source content read-only and pass-through by default.
- Keep source credentials in connectors or a credential broker, never in model context.
- Support selective retrieval as well as an explicitly authorized whole-source/project view.
- Provide redaction, classification, provenance, freshness, and audit metadata.
- Make source connectors replaceable and usable locally, self-hosted, or through Rostrum Cloud.

## Non-goals

- Writing messages, documents, issues, or source records from the context layer.
- Building a general-purpose customer data lake or searchable message warehouse.
- Guaranteeing that source content is free of secrets, malware, or prompt injection.
- Persisting full source content for every run by default.

## Core concepts

| Concept | Meaning |
| --- | --- |
| Context source | A connector and authenticated connection to an external or project information system |
| Context selector | The scope requested from a source: channel, path, URL set, issue, date range, project, or query |
| Context policy | Rules for source, selector, actor, workflow, node, data class, freshness, redaction, and retention |
| Context view | The filtered and redacted read-only projection delivered to a node |
| Context provenance | Source, selector, retrieval time, connector version, policy decision, and integrity metadata |
| Context broker | The service that authenticates to sources, retrieves content, applies policy, and delivers views |

## Pass-through and retention model

The default request path should be:

1. A workflow declares a context requirement.
2. The broker evaluates the node’s identity, workflow policy, project policy, and source connection.
3. The connector retrieves the permitted source content just in time.
4. The broker filters, redacts, classifies, and annotates the content.
5. The context view is streamed or handed to the authorized node.
6. Rostrum records metadata, provenance, policy decisions, hashes, and operational telemetry, but not the source body by default.

The source system remains the system of record. Rostrum may retain a user-approved excerpt, summary, or snapshot when reproducibility or audit requires it, but this must be explicit, visible in the run, and governed by retention policy. Model-provider retention and training settings are part of the source/model policy and must be exposed to the user.

## Required features

### Must

- Source connector interface with read-only capabilities.
- Connection metadata and credential reference separated from retrieved content.
- Context requirement declaration in workflow/node definitions.
- Selector validation and source-specific scope enforcement.
- Policy evaluation before every retrieval.
- Filtering, redaction, sensitivity classification, and size/freshness limits.
- Context view/bundle schema with provenance and integrity metadata.
- Streaming or ephemeral delivery path that does not require a persistent content cache.
- Metadata-only audit record by default.
- Explicit opt-in for source-content retention, with retention and deletion behavior.
- Source credential isolation so agents cannot access tokens or connector APIs directly.
- Prompt-injection and untrusted-content labeling for retrieved material.
- Connector health, consent, revocation, and credential-expiration handling.

### Should

- Repository, issue tracker, Slack, Discord, documentation site, and incident-system connectors.
- Whole-project selectors with explicit policy approval.
- Incremental retrieval with source cursors without storing the content centrally.
- User-visible “what the agent saw” metadata and provenance.
- Local mock connectors and source fixtures for testing.
- Content hashing and source version references for reproducibility without retaining bodies.

### Could

- Customer-managed connector execution.
- On-premise context broker deployment.
- Privacy-preserving semantic retrieval performed within the customer boundary.
- Opt-in encrypted customer-owned context cache.

## Acceptance criteria

1. An agent can retrieve approved Slack or documentation context without receiving the source credential.
2. A request outside the declared selector or policy is denied before source access.
3. The default run record proves which source, selector, policy, and connector version were used without storing the source body.
4. A user can explicitly opt into retaining a context artifact and see its retention policy.
5. Context access is read-only; the context connector cannot create or mutate source records.
6. Retrieved content is labeled with provenance and untrusted-content status before reaching a reasoning node.
7. A source connection can be revoked and subsequent retrievals fail without invalidating historical metadata.

## Open questions and SPIKEs

- How to stream context through local Docker and Rostrum Cloud microVM boundaries.
- Which redaction/classification engine is trustworthy enough for a first release.
- How to represent whole-project access without accidentally granting ambient access.
- How source cursors work when content is not cached by Rostrum.
- Which metadata is safe to retain for audit and reproducibility.
- How provider/model retention policies are negotiated and displayed.

## Ownership boundary

Connector contracts, policy interfaces, local/mock connectors, and self-hosted Docker context broker should be open-source. Rostrum Cloud may provide managed OAuth, hosted connector execution, enterprise credential brokering, tenant policy distribution, and operational controls. Neither deployment should persist source content by default.
