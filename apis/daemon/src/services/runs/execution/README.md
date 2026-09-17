# Sequential execution preparation

This directory prepares one workflow publication for execution. It answers a
single question before anything runs:

> Can this release execute this exact publication with these inputs, and if so,
> what is the runnable form of it?

Preparation never executes work, allocates a run, or reads a database. It takes
the publication's stored canonical text plus the caller's inputs, and returns
either a prepared graph with the accepted inputs, or a refusal that names why
nothing may run.

Sequential execution itself — per-run state, dispatch, output commits, and
terminal results — is not implemented here yet. See
[What is not implemented yet](#what-is-not-implemented-yet).

## What preparation produces

```ts
const result = new WorkflowPreparer().prepare(publication, inputs);

if (result.ok) {
    result.prepared; // the immutable, shareable graph
    result.inputs;   // the accepted inputs, copied and deep-frozen
} else {
    result.reason;   // one of the five distinct refusal reasons
    result.failures; // bounded, sanitized detail with JSON Pointer locations
}
```

`publication` is the exact binding plus the stored canonical text, as
publication retrieval returns them. The caller must have verified the content
against its digest; preparation trusts the bytes and re-checks everything else
it depends on.

A **prepared graph** carries the publication binding, the entry step, every
declared step keyed by id, each step's resolved input bindings, its compiled
output checks, its successors and dependencies, and the compiled schemas of the
workflow's declared inputs. It is read-only and may be shared: every invocation
of the same publication prepares the same kind of graph, and each run keeps its
own mutable progress beside it.

Preparation compiles the operation contracts once per process, so a step's
configuration, input, and output checks are the same immutable objects in every
prepared graph.

## Supported operations

A task step's `config` is exactly the operation declaration. Adding a member or
naming an unknown operation refuses the invocation, because this release would
otherwise ignore behavior the author declared.

| Operation | Config | Inputs | Output |
| --- | --- | --- | --- |
| `greet` | `{"operation":"greet"}` | `{name: string}` | `{greeting: string}`, `Hello, <name>!` |
| `add` | `{"operation":"add"}` | `{left: number, right?: number}` — `right` defaults to zero | `{value: number}` |
| `divide` | `{"operation":"divide"}` | `{dividend: number, divisor: number}` | `{value: number}` |

Input and output objects are closed: an unknown member is rejected. Arithmetic
is ordinary JSON-number arithmetic. A non-finite result fails as
`numeric_overflow`, and a divisor of `0` or `-0` fails as `division_by_zero`.

### Worked example

`add → divide → result` with `{amount: 90, surcharge: 10, people: 4}`:

```json
{
  "inputs": { "amount": {}, "surcharge": {}, "people": {} },
  "steps": [
    { "operation": "add", "inputs": { "left": "inputs.amount", "right": "inputs.surcharge" } },
    { "operation": "divide", "inputs": { "dividend": "step.<add>.value", "divisor": "inputs.people" } },
    { "operation": "result", "inputs": { "total": "step.<add>.value", "perPerson": "step.<divide>.value" } }
  ]
}
```

Preparation resolves those bindings and compiles those checks. Execution then
dispatches `add` with `{left: 90, right: 10}`, commits `{value: 100}`,
dispatches `divide` with `{dividend: 100, divisor: 4}`, and completes the run
with `{total: 100, perPerson: 25}`.

## Refusals

A refusal is not an HTTP error and not a run. It is a domain outcome with a
reason the caller acts on and the failures behind it:

| Reason | Meaning |
| --- | --- |
| `publication_not_found` | No such publication exists. |
| `corrupt_publication` | Stored content failed integrity, parse, or validation. |
| `unsupported_execution` | This release cannot execute every declared step. |
| `invalid_inputs` | The inputs do not satisfy the workflow's declared inputs. |
| `run_snapshot_limit` | The publication cannot be retained inspectably within the snapshot budget. |

Each `failures` entry carries a stable `code`, a JSON Pointer `path`, and a
sanitized `message`. The path is relative to the subject the code belongs to:
the workflow document for document codes (for example
`/steps/2/config/operation`), and the supplied inputs object for input codes
(for example `/people`). A refusal reports at most 32 failures and says how many
it omitted.

Document problems and input problems are reported separately. A publication
this release cannot execute refuses as `unsupported_execution` whatever the
inputs are, because corrected values cannot fix it; a runnable publication with
bad inputs refuses as `invalid_inputs`, and the caller can try again.

### What refuses today

- A `loop` or `conditional` step, and a task step with more than one
  successor: conditional routing, parallel paths, and bounded loops arrive in
  later Epics.
- A step type other than `task` and `result`, an unknown operation, an
  undeclared configuration member, and any configuration on a `result` step.
- A declared value schema this release cannot prepare: an unknown dialect,
  `$id`, the dynamic-scope keywords, a reference that leaves the fragment, a
  reference that resolves nowhere, or a recursion.
- An input that is missing, undeclared, or invalid for its declared schema.

A document that publishes successfully can still declare behavior this release
cannot execute. Refusing the invocation never changes which documents are
publishable, and preparation never silently narrows a document to the part it
supports.

## Value schemas

A workflow's `inputs` and each step's `outputs` are JSON Schema 2020-12
fragments. Preparation checks each fragment against the offline 2020-12
meta-schema, refuses schema features this release does not evaluate, and
compiles the fragment once.

Two rules matter when reading a prepared graph:

- **`format` is an annotation.** The compiled copy drops `format` from schema
  positions, so no value is rejected because of its format. The published
  document is untouched, and `format` inside `const`, `enum`, `default`, or
  `examples` is data and stays.
- **Schema defaults never fill a value.** Checks read values; they never
  convert, clean, or create one.

References are local JSON Pointers into the same fragment. A fragment that
references itself is refused: the compiler behind these checks cannot evaluate
every recursive schema safely, and a plain self-reference exhausts its stack
while compiling.

## Depth and ownership

Every value a caller supplies, a document declares, or a handler produces is
checked before this daemon reads, copies, or stores it. `MAX_VALUE_DEPTH` (128,
counting the root container as level one) bounds both runtime values and schema
fragments; a deployment may lower it.

The check rejects what JSON cannot represent: `undefined`, functions, symbols,
non-finite numbers, references to self, sparse array holes, accessor properties,
and objects whose prototype is neither `Object.prototype` nor `null`. It reads
own property descriptors, so it never runs a getter, and names such as
`__proto__` or `a.b` stay flat own members rather than becoming a prototype or a
nested path.

Accepted inputs are copied and frozen; the daemon never reads caller-owned
memory after acceptance. Literal bindings are frozen in place, so a handler
cannot change a value another run of the same prepared graph will read.

## Modules

| Module | Responsibility |
| --- | --- |
| `workflow-preparer.ts` | Reads the publication, checks execution support, compiles declared schemas, validates inputs, and produces the prepared graph or the refusal. |
| `value-schema.ts` | Validates a fragment against offline 2020-12 resources, refuses unsupported schema features, strips `format` annotations, compiles the check, and locates a failing value. |
| `json-value.ts` | Checks, copies, and freezes JSON values, including the depth bound. |
| `operation-contracts.ts` | The supported operations and their configuration, input, and output schemas. |
| `task-executor.ts` | The boundary one task execution crosses: `TaskWorkItem` in, `TaskWorkResult` out. |

### The task boundary

The daemon selects work, records it, and commits outcomes; an executor receives
one work item and returns one result. A `TaskWorkItem` carries the run id, work
id, step id, workflow-format version, the validated configuration, and the fully
resolved inputs — everything the operation needs, and nothing else: no database
handle, request context, engine callback, prepared graph, or reference into run
state. A `TaskWorkResult` is either a complete output or a typed failure, never
both and never a partial output.

M2 runs the executor inside the daemon process. The boundary exists so a later
worker implementation can take that responsibility without taking ownership of
the workflow. It does not, by itself, make execution distributable: durable
dispatch, leases, authentication, and duplicate delivery are separate work.

## Bounds this release keeps fixed

Alongside the configurable depth, two limits are properties of the
implementation rather than operator settings: a refusal reports at most 32
failures before it says how many it omitted, and every failure message is
bounded and sanitized — messages never carry raw exceptions, connection
details, or input values.

## What is not implemented yet

- Per-run state, binding resolution at dispatch, task dispatch and completion,
  and terminal result completion (checkpoint 2).
- Run services, controllers, routes, and OpenAPI documents in either service
  (checkpoint 3).
- Configuration for the run limits, the `smoke:sequential` command, and the
  lifecycle drain of accepted runs (checkpoints 3 and 4).

`WorkflowPreparer` and `ValueSchemaCompiler` are constructed once per process at
startup, so a removal or capacity change takes effect on restart.

## Tests

```bash
bun test apis/daemon/src/services/runs
```

The preparation suite canonicalizes documents the way publishing does, then
proves the worked example, the greeting and minimum fixtures, step-order
independence, input presence rules, every refusal reason, the failure bound, and
that accepted inputs are owned copies. The schema suite proves what is enforced,
refused, and left as an annotation, and where a failing value is reported.
