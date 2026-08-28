# E2-01: Clarify workflow interface terminology

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | None |

## Task

This task replaces the phrase `rule set` and the related `ruleset` identifiers with terminology that accurately reflects what the code or document contains. It also decides whether Rostrum needs one object that groups every interface-version concern while only workflow interface v1 exists.

The current `InterfaceRuleSet` groups five responsibilities:

- an exact interface-version token;
- the workflow document schema;
- the registry of supported step types and their configuration schemas;
- metadata fields excluded from publication digests (the canonical content hashes for published workflow versions);
- the ordered validation stages.

`RuleSetRegistry` selects one of these objects based on the `interfaceVersion` document field. The phrase `rule set` does not clarify which of those responsibilities is relevant, and readers can easily confuse it with validation rules alone. Epic 02 also adds execution-facing step contracts, which would make `rule set` broader and less precise.

## Alternatives to assess

The implementation compares four alternatives against current and planned callers.

| Alternative | Shape | Benefit | Cost or risk |
| --- | --- | --- | --- |
| Workflow interface definition | Rename the grouped object to `WorkflowInterfaceDefinition` and the selector to `WorkflowInterfaceRegistry`. | Names the artifact and preserves exact version lookup without implying that it contains only validator rules. | Keeps a bundle that may still collect unrelated responsibilities. |
| Explicit version module | Export the v1 schema, step registry, metadata classification, and validation pipeline separately from one `v1` module. Select the supported version with a small function or map. | Removes the general-purpose container until a second interface version proves that it is useful. | Callers that need several version-specific values must receive them separately. |
| Split authoring and execution contracts | Separate the document-validation definition from the runtime step contract and select both through the `interfaceVersion` field. | Gives each object one purpose and prevents execution concerns from expanding a validator container. | Adds coordination between two versioned objects and may be premature while only v1 exists. |
| Validation profile | Rename the current object to a validation profile. | Uses familiar wording for a configured validation pipeline. | Incorrectly narrows an object that also controls step types and digest metadata (document metadata fields, such as workflow name and description, that are excluded when calculating publication digests). |

The recommended names are `WorkflowInterfaceDefinition` and `WorkflowInterfaceRegistry` because the grouped values all describe one supported workflow interface version. If call-site inspection shows that callers use unrelated fields independently and direct exports from the v1 module are simpler, remove the grouped object instead. Do not use `ValidationProfile` because it hides the digest-metadata and step-type responsibilities.

## Scope

Apply the selected terminology and structure across:

- `packages/workflow` source, exports, tests, and code comments;
- Control API code that selects or describes a workflow interface version;
- workflow specifications and implementation documentation;
- strategy documents that explain workflow versions or execution;
- examples and diagrams that use `rule set` as an unexplained container term.

Historical quotations can retain the original words when changing them would alter the source text. Decision records must otherwise describe the current design rather than preserve obsolete implementation names.

## End state

A reader can tell whether a sentence refers to a workflow interface version, document schema, validation stage, step-type contract, digest rule, or runtime behavior without learning a Rostrum-specific meaning for `rule set`.

## Why

Epic 02 extends the shared workflow contract before building execution. Leaving the current term in place would make new runtime documents harder to understand and would encourage more responsibilities to accumulate under an unclear abstraction.

## Blocks

- [E2-03: Define the executable workflow contract](e2-03-define-executable-workflow-contract.md)
- [E2-05: Build the local daemon](e2-05-build-local-daemon.md)

## Acceptance criteria

- The task records the selected alternative and explains why it fits both workflow interface v1 and future interface versions.
- The selected design preserves exact `interfaceVersion` matching and the list of supported versions.
- Every retained grouped object has one plain-language definition that lists what it contains and explains why those values change together.
- Redundant grouping or registry code is removed if direct v1 exports and a small selector provide the same behavior more clearly.
- Public TypeScript symbols, filenames, variables, tests, and comments use the selected terminology consistently.
- Strategy, specification, decision, result, Epic, and task documents use specific terms instead of the generic phrase `rule set`.
- No unexplained `rule set`, `ruleset`, `InterfaceRuleSet`, `RuleSetRegistry`, `V1_RULE_SET`, or equivalent identifier remains outside historical quotations or research that discusses the removed alternative.
- Existing exact-version selection, validation, publication digest, and supported-version tests continue to pass without compatibility aliases.
