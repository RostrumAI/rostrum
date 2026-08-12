# E1-S1 decision: Workflow JSON v1 shape and interface evolution

| Tracking | Value |
| --- | --- |
| Status | Proposed — awaiting approval |
| Source | [E1-S1: Decide the workflow JSON v1 shape](../../tasks/epic-01/e1-s1-define-workflow-interface-v1.md) |
| Last updated | 2026-08-12 |

## Decision

Workflow JSON v1 is a single JSON object in camelCase. Its top level declares the interface version, workflow identity, named inputs, and an ordered list of steps. Control flow is explicit on each step through either `next` (sequential) or `branches` (conditional); a step with neither is a terminal result. Data moves between steps through structured `{ "ref": "..." }` references resolved against workflow inputs and upstream step outputs. Step types are registered by name and contribute a configuration schema; Rostrum selects the document schema and the step-type registry from the declared `interfaceVersion`, and every future release retains the v1 rule set so v1 documents validate identically forever.

The authored document carries no lifecycle fields: creation time, revision, published-version identity, and digest are server-managed and belong to E1-S3, not to the workflow JSON an author writes.

## Context

E1-S0 fixed the stack — TypeBox as the single schema language, JSON Schema 2020-12 as the public contract dialect — and its proof of concept sketched a provisional shape (`interfaceVersion`, `id`, `name`, `createdAt`, `start`, `steps[].{id,type,next}` with `task` and `result` types). That scaffold was removed after verification; it proved the toolchain, not the shape. E1-S1 now fixes the shape itself.

The epic constrains v1 to be small and settled before the validator and JSON Schema become public contracts. It must describe sequential steps, branches, and terminal results, with inputs, connections, data references, and step-type extension answered unambiguously for a new engineer. Later versions add loops, joins, and parallel fan-out; v1 does not express them.

The shape must satisfy four consumers with one definition:

- human and automated authors, who read and write the JSON;
- the shared validator (E1-04), which checks it mechanically;
- the Control API (E1-06), which carries it across the service boundary;
- the future daemon (Epic 02), which executes it.

Unknown fields and unknown step types must produce clear validation errors, not be silently ignored, so an author cannot ship a workflow Rostrum will misinterpret.

## Why these choices

| Aspect | Choice | Reason |
| --- | --- | --- |
| Field casing | camelCase | Matches the E1-S0 proof-of-concept shape and the TypeScript/TypeBox toolchain; no casing translation layer. |
| Interface version | Top-level `interfaceVersion` string, exact-match (`"v1"`) | A capability token, not a number or semver. Exact matching means Rostrum never guesses a version's rules. |
| Identity | `id` (stable), `name` (required), `description` (optional) | Separates the machine-stable key from human-facing labels; `description` is optional so a quick draft stays small. |
| Inputs | Name-keyed object `inputs` where each value is a JSON Schema 2020-12 fragment | References address inputs by name; an object forbids duplicate input names by construction and uses the schema language E1-S0 already standardized. |
| Steps | Ordered array `steps` of step objects | Order is authoring and display order; execution order is explicit via `next`/`branches`. Duplicate step `id` is a validation error. |
| Step identity and type | `id` (unique string), `type` (step-type name) | `id` is the reference target; `type` selects the step's config schema from the registry. |
| Step configuration | `config` object validated against the step type's schema | The single extension point: a new step type contributes a `type` name plus a config schema, with no change to the base shape. |
| Data references | Structured `{ "ref": "..." }` value | Static and schema-checkable, unlike string interpolation, so unresolved references are detected before execution. |
| Control flow | `next` (sequential) XOR `branches` (conditional), neither means terminal | Local to each step, readable at v1's graph scale, and makes "where a step goes next" explicit rather than a separate edge table. |
| Branches | `branches` array of `{ "outcome", "next" }` plus optional `default` | Outcomes lead to named next steps, matching the epic; `default` names the no-match path so a branch can never fall through silently. |
| Terminal results | A step with neither `next` nor `branches`, typed `result`, whose `inputs` are the workflow outputs | Makes "where the workflow finishes and what it produces" a concrete, branchable step instead of a detached global output block. |
| Lifecycle fields | Excluded from authored JSON | `createdAt`, revision, version number, and digest are server-assigned; mixing them into authored JSON couples the document to a specific save or publish event. E1-S3 defines them. |

## Specification outline

Every field is named here. Required fields are marked **required**; a field that can be omitted defaults to the stated empty value. All names are camelCase.

### Top-level object

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `interfaceVersion` | string | **required** | The workflow interface version. v1 is the literal `"v1"`. Rostrum selects the document schema and rule set from this value. |
| `id` | string | **required** | Stable workflow identifier, unique within a workspace. Referenced by the Control API and future execution requests. |
| `name` | string | **required** | Human-facing workflow name. |
| `description` | string | optional | Human-facing description. Defaults to absent. |
| `start` | string | **required** | The `id` of the step where execution begins. |
| `inputs` | object | optional | Workflow inputs. Each key is an input name; each value is a JSON Schema 2020-12 fragment describing the accepted value. Defaults to `{}`. |
| `steps` | array | **required** | Ordered list of step objects. Minimum length 1. Execution order follows `next`/`branches`, not array order. |

### Step object

Every step shares the same base shape; `config` is the step-type-specific part.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | **required** | Step identifier, unique across the workflow's `steps`. The target of `start`, `next`, `branches[].next`, and `default`. |
| `type` | string | **required** | Step-type name. Selects the config schema and validation rules from the registry. |
| `config` | object | optional | Step-type-specific configuration, validated against the step type's config schema. Defaults to `{}`. |
| `inputs` | object | optional | Bindings from this step's input names to literal values or references. Defaults to `{}`. |
| `outputs` | object | optional | Declared outputs. Each key is an output name; each value is a JSON Schema 2020-12 fragment describing the produced value. Defaults to `{}`. |
| `next` | string | optional | The single successor step `id` (sequential). Mutually exclusive with `branches`. |
| `branches` | array | optional | Conditional routing: an ordered array of `{ "outcome": <string>, "next": <string> }`. Outcomes must be unique. Mutually exclusive with `next`. |
| `default` | string | optional | The step `id` taken when no branch `outcome` matches. Allowed only alongside `branches`. |

Control-flow rule: a step has exactly one of `next`, `branches`, or neither. A step with neither is terminal and must be typed `result`.

### Data references

A binding value is either a JSON literal (string, number, boolean, object, array, or null) or a reference object with the exact shape `{ "ref": "<path>" }`. A path is one of:

- `inputs.<name>` — a workflow input;
- `step.<stepId>.<outputName>` — an output declared by an upstream step.

A reference resolves to the referenced value at execution time. The terminal result's workflow outputs are written the same way: a `result` step binds its `inputs`, and the resolved object is the run's terminal result.

A JSON object whose only key is `ref` with a string value is always interpreted as a reference, never as a literal. Passing such a literal object requires an escape syntax deferred to E1-03 if a real workflow needs it.

### Built-in step types

The shape fixes the extension mechanism, not the step catalog. Two demonstrative types are named here to make the mechanism concrete; the authoritative reference step set is selected by E2-S3.

| Type | `config` | `outputs` | Meaning |
| --- | --- | --- | --- |
| `task` | `{ "operation": "<string>" }` plus type-specific fields | Declared by the author | A deterministic unit of work. Its handler (Epic 02) produces the declared outputs. |
| `result` | none required | none | A terminal step. Its `inputs` bind the workflow outputs; the resolved `inputs` object is the run's terminal result. |

## Step-type extension rules

A step type is a registry entry keyed by its `type` string. The entry contributes the step type's contract:

- a JSON Schema 2020-12 fragment for the step's `config` object;
- any additional validation rules beyond the config schema, such as required `outputs` or a constraint on `config` values.

Rostrum validates a step's `config` against the schema registered for its `type`. A step whose `type` is not registered is a blocking finding — the workflow is invalid, not silently reinterpreted. A step type whose `config` schema changes incompatibly is treated as an interface change: additive relaxations keep existing documents valid, while a change that invalidates a previously valid `config` requires a new interface version or a new type name. Adding a step type never changes the base document shape, so it is a backward- and forward-compatible extension in both directions: older releases reject the new type explicitly, and newer releases read existing types identically.

## Interface versioning and evolution

- Rostrum supports a set of interface versions by retaining one immutable rule set per version: the document schema plus the step-type registry for that version. v1 is the first such set.
- Selecting rules is an exact match on `interfaceVersion`. An unknown version is a blocking finding, never a silent fallback to v1 or to the nearest version.
- Additive change within a version — a new optional top-level field, a new step type, a relaxed validation — is allowed only if every previously valid v1 document remains valid. A new step type is additive: it extends the registry, and older releases reject it explicitly as unsupported rather than misreading it.
- Breaking change requires a new interface version (`"v2"`, `"v3"`, ...). Rostrum retains the v1 rule set alongside it, so a v1 document keeps validating and executing exactly as before. There is no automatic upgrade or rewriting: a v1 document stays v1.
- Future releases continue to recognize v1 because the v1 schema, step-type registry, and validation rules are frozen and shipped forward, not replaced. Recognition means "validated and executed with v1 semantics", not "migrated to the newest version".

## Representative examples

### Valid — sequential with terminal result

```json
{
  "interfaceVersion": "v1",
  "id": "greet-summarize",
  "name": "Greet and summarize",
  "description": "Bind a name, produce a greeting, return it.",
  "start": "greet",
  "inputs": {
    "name": { "type": "string" }
  },
  "steps": [
    {
      "id": "greet",
      "type": "task",
      "config": { "operation": "greet" },
      "inputs": { "name": { "ref": "inputs.name" } },
      "outputs": { "greeting": { "type": "string" } },
      "next": "finish"
    },
    {
      "id": "finish",
      "type": "result",
      "inputs": { "greeting": { "ref": "step.greet.greeting" } }
    }
  ]
}
```

### Valid — branching with two terminal results

```json
{
  "interfaceVersion": "v1",
  "id": "classify",
  "name": "Classify a score",
  "start": "check",
  "inputs": {
    "score": { "type": "number" }
  },
  "steps": [
    {
      "id": "check",
      "type": "task",
      "config": { "operation": "threshold" },
      "inputs": { "score": { "ref": "inputs.score" } },
      "outputs": { "decision": { "type": "string" } },
      "branches": [
        { "outcome": "high", "next": "high-result" },
        { "outcome": "low", "next": "low-result" }
      ],
      "default": "low-result"
    },
    {
      "id": "high-result",
      "type": "result",
      "inputs": { "decision": { "ref": "step.check.decision" } }
    },
    {
      "id": "low-result",
      "type": "result",
      "inputs": { "decision": { "ref": "step.check.decision" } }
    }
  ]
}
```

### Incomplete — valid JSON, fails validation

Syntactically valid and saveable as a draft, but not publishable: `next` names a step that does not exist and the workflow has no terminal result.

```json
{
  "interfaceVersion": "v1",
  "id": "incomplete",
  "name": "Unfinished workflow",
  "start": "first",
  "steps": [
    { "id": "first", "type": "task", "next": "missing" }
  ]
}
```

### Invalid — unsupported step type

Fails validation because `no-such-type` is not registered; the error must be explicit, not ignored.

```json
{
  "interfaceVersion": "v1",
  "id": "bad-type",
  "name": "Unknown step type",
  "start": "x",
  "steps": [
    { "id": "x", "type": "no-such-type" }
  ]
}
```

### Invalid — unknown interface version

Fails validation because no rule set exists for `v2` in a release that ships only v1; it is never treated as v1.

```json
{
  "interfaceVersion": "v2",
  "id": "future",
  "name": "Not yet supported",
  "start": "x",
  "steps": [
    { "id": "x", "type": "task", "config": { "operation": "noop" } }
  ]
}
```

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Interface version as integer or semver | Implies numeric ordering Rostrum never needs; exact-match string tokens make "known version" a plain membership test with no ordering or range logic. |
| String-interpolation references (`"${inputs.name}"`) | Requires string parsing, is invisible to the schema, and defeats static reference resolution; structured `{ "ref": "..." }` values are schema-checkable before execution. |
| A separate edge/connection list apart from steps | Spreads control flow across the document and adds a cross-reference layer the v1 graph scale does not need; `next`/`branches` on the step keep flow local and readable. |
| One inline `anyOf` union enumerating every step type | Breaks the extension promise: adding a step type would rewrite the base schema, and unknown types would surface as opaque union failures instead of a clear unsupported-type finding. |
| A single top-level `outputs` declaration | Cannot express per-branch terminal results; a terminal `result` step makes each finish point a concrete, referenceable step. |
| `createdAt` (and other lifecycle fields) inside authored JSON | Couples the document to one save or publish event and forces authors to fabricate or omit server-owned values; the boundary keeps authored JSON author-only. |

## Deferred decisions

- The authoritative step-type catalog and each type's config schema and handler semantics are selected by E2-S3 and later epics. This record fixes only the extension mechanism and the two demonstrative types.
- Reference-literal escaping for values that are the literal object `{ "ref": "..." }` is deferred to E1-03 if a workflow requires it.
- Lifecycle identifiers — creation time, draft revision, published-version number, and digest — are E1-S3's scope and are intentionally absent from the authored shape.
- Loops, joins, and parallel fan-out are future interface versions; v1 covers sequential, branching, and terminal flow only.

## Verification

This record is complete when a reviewer can confirm, by reading it, that:

- the specification outline names every v1 field and covers inputs, steps, connections, branches, data references, and terminal results;
- the interface-version and step-extension rules are explicit;
- the examples include at least one valid, one incomplete, and one invalid workflow demonstrating the proposed shape;
- the evolution rules explain how a future release continues to recognize v1.

The product owner and implementing engineer approve this decision before E1-S2 and E1-S3 build on it and before E1-03 turns it into the public specification and JSON Schema.
