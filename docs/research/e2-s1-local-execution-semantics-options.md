# E2-S1 research: Local execution semantics options

| Tracking | Value |
| --- | --- |
| Status | Owner decisions recorded; ready for decision record |
| Source | [E2-S1: Decide how a local run advances](../tasks/epic-02/e2-s1-define-local-execution-semantics.md) |
| Proof | [E2-S1 local execution proof of concept](../results/epic-02/e2-s1-proof-of-concept.md) |
| Last updated | 2026-08-26 |

## Purpose

This research identifies the decisions needed to define how a local run starts, advances, completes, and fails. It compares execution models, records the product owner's execution decisions, proposes a decision method, and preserves one remaining topology question.

The working architecture is an immutable compiled execution plan plus a per-run transition reducer and ready queue. The proof of concept demonstrates sequential flow, conditional paths, structured fan-out and fan-in, capacity-limited dispatch, sequential loop iterations with structured graph bodies, complete failure lists, current-step projection, static handler contracts, structured runtime failures, and edge-indexed graph advancement. All topology and semantic questions, including Q18, are resolved.

## Inputs from approved and planned work

The [workflow interface v1 specification](../specs/workflow-interface-v1.md) already fixes several runtime facts:

- A run binds to an exact immutable published workflow version.
- `firstNode` activates the first step.
- `successors` express unconditional fan-out.
- `dependencies` express fan-in prerequisites.
- A top-level conditional evaluates committed step outputs and selects one branch by priority, with a required default.
- References address workflow inputs, committed step outputs, and a loop variable.
- A terminal `result` step binds its inputs as the workflow result.
- The current specification lets a branch without `next` end the workflow with the conditional owner's outputs. The owner decision below replaces this rule with an explicit result step on every path.
- A bounded loop has a collection, `maxIterations`, variable, and body subgraph.
- A run keeps the exact published version and rule set selected at invocation.

Epic 02 adds constraints of its own:

- The daemon, not the Control API or caller, advances a run.
- Invocation returns a stable run ID after acceptance.
- Invalid inputs fail before a handler runs.
- Reference handlers are deterministic and have no side effects.
- Runs are in memory in Epic 02.
- Persistence, recovery, attempts, retries, waits, pause, cancellation, and durable events belong to Epic 03.

### Product owner decisions and Epic 01 impact

The product owner resolved the blocking execution questions on 2026-08-25.

| ID | Decision | Runtime consequence |
| --- | --- | --- |
| Q1 | Epic 02 executes every control-flow construct that Epic 01 can publish. | The daemon cannot accept only a sequential subset of workflow interface v1. |
| Q2 | Every name in `workflow.inputs` is required when a run is invoked. Every step input must resolve before that step runs. | Missing workflow inputs reject invocation. A missing workflow or upstream-step reference fails the consumer before its handler starts. The undeclared-input policy remains Q16. |
| Q3 | Conditional branch priorities are unique. | Duplicate priorities are blocking publication findings; array order never breaks a tie. |
| Q4 | Fan-out is structured. A fan-out region cannot contain a conditional, and every branch must reach one matching fan-in before an explicit result. Different mutually exclusive conditional paths may each have their own result step. | A selected path produces exactly one run result. Multiple result steps can exist statically when conditionals make them mutually exclusive. |
| Q5 | A step inside an open fan-out region cannot be terminal. | Every fan-out branch must reach the matching fan-in. |
| Q6 | Each loop iteration produces exactly one output, under the same structured-path rule. | The loop collects one terminal output object per iteration. |
| Q7 | Loop iterations execute sequentially. | Iteration $n + 1$ starts only after iteration $n$ commits its result. The `results` array follows collection order. |
| Q8 | Fan-out requests simultaneous handler invocation subject to available capacity. Execution order and actual overlap are not guaranteed. | All branch roots become ready as one cohort. The dispatcher starts as many as capacity allows, and the fan-in waits for every branch to succeed. |
| Q9 | A missing registered handler rejects invocation. | The daemon returns no run ID for a statically unsupported workflow. |
| Q10 | Every successful handler outcome contains an explicit output object. An empty object is a valid explicit output. | A handler cannot signal success without `outputs`; `{ "outputs": {} }` represents no values. Exact declared-versus-undeclared output handling remains Q17. |

These decisions require amendments to the current Epic 01 specification and validator before Epic 02 implementation treats published v1 documents as executable:

- Require unique conditional priorities.
- Require `next` on every conditional branch and default so terminal results are explicit result steps.
- Define structured single-entry, single-exit fan-out regions with one matching fan-in.
- Reject conditionals and terminal steps inside an open fan-out region.
- Permit multiple result steps only on mutually exclusive conditional paths.
- Require each loop iteration to select one terminal body output and execute iterations sequentially.

Until those amendments land, Epic 01 can publish graphs that the owner-decided Epic 02 semantics reject. Q1 prohibits leaving that mismatch in the implementation contract.

## Comparative research

The systems below use different authoring models, but the same execution questions recur.

| System | Relevant behavior | Lesson for Rostrum |
| --- | --- | --- |
| [AWS Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html) | A state error fails the execution unless a matching retry or catch handles it. Errors have stable names. Choice rules use first-match order and recommend a default. A Parallel state waits for every branch; an unhandled branch failure fails the Parallel state and stops its branches, although invoked Lambda work can continue. | Keep routing order total, make failure sticky, and state what happens to work that was already dispatched. Do not imply that fail-fast can forcibly stop arbitrary handlers. |
| [Temporal](https://docs.temporal.io/workflow-execution) | Workflow and Activity failures are separate. A Workflow remains `Running` while it waits. Commands and events form a durable history; replay restores state. Activity retries are separate from Workflow failure. | Separate orchestration failure from handler failure. Event-history replay is useful for Epic 03, but it adds machinery that an in-memory Epic 02 run does not need. |
| [Apache Airflow](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/tasks.html) | Task instances distinguish `none`, `scheduled`, `queued`, `running`, success, failure, retry, skip, and upstream failure. A task normally runs after all upstream tasks succeed. DAG-run outcome depends on leaf states, so a successful permissive leaf can mask an upstream failure. | Separate step and run states, but make an unhandled failure permanently prevent run success. Do not derive success only from the last leaf. |
| [Argo Workflows](https://argo-workflows.readthedocs.io/en/latest/walk-through/dag/) | Dependency-free tasks start first; completed dependencies release downstream work. DAGs fail fast by default: no new task is scheduled after a failure, while running tasks finish. `depends` can distinguish succeeded, failed, errored, skipped, and omitted outcomes. Workflow and controller parallelism cap work independently of DAG shape. | Model activation, outcome, and capacity separately. "Ready together" is the scalable meaning of fan-out; worker capacity controls actual starts. |
| [Prefect](https://docs.prefect.io/v3/concepts/states) | State type drives orchestration and state name provides display detail. Futures create data dependencies. A flow's return value determines final state, and code can accidentally return successfully after observing a failed task. | Keep public run states small. Never let a normal return path erase an unhandled failed step. |
| [Conductor OSS](https://conductor-oss.github.io/conductor/devguide/architecture/tasklifecycle.html) | Task states distinguish scheduled, in progress, completed, retryable failure, terminal failure, timeout, cancellation, skip, and completed with errors. Workers poll queued tasks and report outcomes. | A stable handler outcome envelope scales to workers. Retry classification belongs to an attempt policy, not an exception message. |
| [Camunda 8](https://docs.camunda.io/docs/components/concepts/processes/) | Process execution uses tokens. Gateways split, select, and join tokens. Jobs isolate external work. A modeled business error follows process flow; a technical problem can create an incident that stops progress. | An activation token or bit explains branch and join readiness. Keep ordinary branch results separate from runtime faults. |
| [Azure Durable Task](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-error-handling) | Activity failures return to the orchestrator through a stable failure representation. Orchestrator code can catch, compensate, or retry. Fan-out creates independent tasks and fan-in waits for all. | Normalize thrown handler errors before they cross the orchestration boundary. Durable retries and compensation can extend the same handler boundary later. |
| [n8n](https://docs.n8n.io/build/flow-logic/understand-execution-order) | New workflows execute one canvas branch to completion before the next by default. Queue mode passes execution IDs through Redis; workers load workflow data from the database and write results back. | Do not couple runtime order to visual position. At deployment scale, queue identities and load immutable plans from shared storage instead of copying whole workflows through the broker. |

### Repeated patterns

The common design is not a single cursor over a JSON array. Mature systems keep at least four concepts separate:

- the immutable workflow definition or code;
- the run's orchestration state;
- an individual task or activity state;
- handler data and errors.

They also distinguish graph eligibility from available execution capacity. Airflow has scheduled and queued states, Argo has DAG dependencies plus parallelism limits, and Conductor places scheduled tasks in worker queues. This distinction lets the same successful-run semantics operate in one process or across a worker fleet.

Two failure traps are worth avoiding. Airflow can report a successful DAG when a permissive leaf succeeds after an upstream failure. Prefect can report a completed flow when code observes a failed task state but returns normally. Rostrum's unhandled run failure must be sticky: no later result can turn that run into success.

## Architecture options

### Option A: Single cursor interpreter

Store one current step ID. Resolve its inputs, call its handler, record its output, and replace the cursor with the selected successor.

| Property | Assessment |
| --- | --- |
| Sequential and exclusive branch flow | Simple and easy to trace |
| Fan-out and fan-in | Requires a second model or serializes branches contrary to the interface |
| Failure handling | Simple only while one step can be active |
| Persistence later | Cursor does not record multiple active or completed branches |
| Scale | One active step per run; no natural backpressure or worker queue boundary |

This option matches the wording in the current E2-05 task, but it cannot implement the complete v1 graph without a later semantic rewrite.

### Option B: Compiled plan plus transition reducer and ready queue

Compile the immutable workflow once into indexes. A run owns a small mutable projection: step states, activations, remaining dependency counts, ready work, active work, committed outputs, selected branches, and terminal outcome. Every handler completion is an input to one serialized transition reducer.

| Property | Assessment |
| --- | --- |
| Sequential and exclusive branch flow | A ready set of size one behaves like a cursor |
| Fan-out and fan-in | Fan-out activates several steps; dependency counters release a join once |
| Failure handling | The reducer makes terminal transitions and fail-fast scheduling explicit |
| Persistence later | The projection and transition inputs can be checkpointed without changing successful behavior |
| Scale | Immutable plans can be cached; ready attempts can use a bounded local or distributed worker pool |

This is the working recommendation. The [proof of concept](../results/epic-02/e2-s1-proof-of-concept.md) exercises the core behavior and large synthetic graphs.

### Option C: Event-sourced replay engine

Record every command and result in an append-only history, then reconstruct the run by replaying a deterministic orchestrator, similar to Temporal or Durable Task.

| Property | Assessment |
| --- | --- |
| Sequential, branch, and parallel flow | Complete when the command and event language is complete |
| Failure handling | Strong audit and recovery model |
| Persistence later | Native |
| Scale | Proven architecture, but requires history storage, replay, versioning, compaction, and worker protocols |
| Epic 02 fit | Poor; most of the machinery exists to solve Epic 03 and later durability problems |

This option is credible but premature. Epic 03 can add durable transition records around Option B without requiring workflow-code replay.

## Working recommendation

Use Option B and specify it as a state-transition contract, not as one implementation class. The contract has three layers:

1. **Plan compilation.** Verify the published digest and supported interface version, build indexes, and verify that every required handler exists. Cache the plan by interface version, digest, and registry revision.
2. **Run reduction.** Apply one transition at a time to one run. The reducer is the only code that changes step state, commits outputs, selects branches, or sets terminal state.
3. **Dispatch.** Pull ready step instances up to a configured concurrency limit, resolve their inputs, call handlers, and return normalized outcomes to the reducer.

The reducer is a single writer per run. Handlers may execute concurrently, but their completions enter the reducer serially. This removes data races without requiring a global lock across runs.

### Public run states

Use four public states in Epic 02:

| State | Terminal | Meaning |
| --- | --- | --- |
| `queued` | No | The daemon accepted the invocation and assigned a run ID, but execution has not started. |
| `running` | No | The run can still make progress. This includes time spent waiting for active handlers. |
| `succeeded` | Yes | One approved terminal rule produced the run output. |
| `failed` | Yes | An unhandled runtime failure prevents further progress. |

`rejected` is an invocation result, not a run state, because a rejected invocation creates no run. `stopping` can be an internal phase while already active side-effect-free handlers drain after a failure. It does not need to become part of the Epic 02 Control API.

Epic 03 can add waiting, paused, cancelling, and cancelled states when those transitions exist. Adding names before behavior exists would create unreachable public states.

### Internal step states

Use these states for each top-level step instance:

| State | Meaning |
| --- | --- |
| `pending` | The step has not become eligible. |
| `ready` | A selected path activated the step and every declared dependency succeeded. |
| `running` | The dispatcher handed the step to its handler, or the executor is evaluating a virtual `result` step. |
| `succeeded` | The output passed runtime validation and committed. |
| `failed` | Binding, handler execution, outcome decoding, or output validation failed. |
| `notSelected` | The run terminated without selecting a path to this step. |

A binding failure can move a step directly from `ready` to `failed` because no handler ran. Terminal states are absorbing.

The Control API run projection includes `currentSteps`, an array of every `ready` and `running` step instance. Each entry contains `stepId`, state, and the iteration index when the step is inside a loop. A capacity-limited fan-out can therefore expose one running branch and other ready branches at the same time. The array is empty for queued and terminal runs. Historical step transitions remain part of conformance traces until Epic 03 defines durable observation.

### Invocation acceptance

Run these checks before creating a run:

1. The request has the required workflow identity, exact published version, and JSON input object.
2. The published version exists, its digest verifies, and its interface version is executable by this daemon.
3. The execution plan compiles without an internal invariant failure.
4. Every task type or operation in the plan has a registered handler.
5. Every declared workflow input is present and satisfies its JSON Schema; undeclared invocation inputs are rejected.

A rejection returns a stable invocation problem and no run ID. An accepted request creates the run in `queued`, returns its ID, and cannot later be reclassified as rejected.

This boundary keeps caller errors and static platform incompatibility out of run history. Once durable acceptance exists in Epic 03, the daemon must commit the initial run before acknowledging acceptance.

### Readiness and activation

A step is ready when all of these predicates are true:

1. The run is nonterminal and has not observed an unhandled failure.
2. The step is `pending`.
3. The step is activated by `firstNode` or by a selected incoming control-flow edge.
4. Every step ID in `dependencies` has a committed `succeeded` outcome.
5. The step belongs to the active loop scope, when applicable.

Activation is an OR condition across selected incoming control-flow edges. Dependencies are an AND condition. This distinction supports an exclusive branch merge without making both branches dependencies, and it supports a true fan-in when the author lists every parallel predecessor as a dependency.

Each top-level step executes at most once per run. Repeated activations coalesce. A loop step uses a separate step-instance key for each body step and iteration index. Iterations activate one at a time.

Use an integer remaining-dependency count and a reverse dependency index. When a step succeeds, decrement each direct consumer once. Do not scan all steps or all dependency lists after every outcome.

### Inputs, references, and outputs

Treat workflow JSON, invocation input, and committed step outputs as immutable values. A handler receives a resolved input object and cannot access the mutable run projection.

Resolve a reference only from:

- the accepted invocation input;
- a committed `succeeded` step output in the same run and scope;
- the current loop item in the same iteration scope.

A reference to a missing value, failed producer, uncommitted producer, wrong loop scope, or absent output fails the consumer before its handler runs. The runtime must not substitute `null`, an empty string, or the reference text.

On handler success, validate the outcome before commit:

- the outcome contains an explicit `outputs` object, including `{}` when the handler produces no values;
- the object is JSON serializable;
- every returned output satisfies its declared JSON Schema;
- every declared output is present and no undeclared output exists.

Only a committed successful output becomes visible to downstream bindings. Do not deep-copy the complete run state on each transition. The runtime owns parsed JSON values and passes read-only views. Large artifact offloading belongs to the later artifact contract.

### Handler boundary

A handler returns one discriminated outcome:

```ts
interface StepSuccess {
    kind: "success";
    outputs: Record<string, JsonValue>;
}

interface StepFailure {
    kind: "failure";
    code: string;
    message: string;
    details: Record<string, JsonValue>;
}

type StepOutcome = StepSuccess | StepFailure;
```

The executor converts a thrown exception, rejected promise, malformed outcome, non-JSON value, or schema mismatch into a runtime failure. Public failure details must not depend on exception class names or stack text. Internal logs can retain the original cause with the run and step IDs.

A handler cannot omit `outputs` on success. Returning `{ kind: "success", outputs: {} }` explicitly records that the handler produced no values.

Each step registry entry supplies configuration, required-input, optional-input, and output schemas. Publication checks that every required handler input has a binding, every provided binding names a required or optional input, and statically known binding types match. Optional inputs can be omitted; any provided optional binding must resolve before the handler starts.

The authored output declaration must exactly match the registry output schema. The runtime then validates the returned values against that exact declaration before commit. A step type whose output schema depends on configuration must derive the concrete schema during validation and plan compilation.

Epic 02 has no retry transition. A `failure` outcome is terminal for the run. Epic 03 can attach retry classification and attempt identity without changing the success shape.

### Branch selection

The executor, not the handler, evaluates the conditional after the owner step's output commits. Evaluation is pure and reads only committed values.

Every conditional priority is unique. Reject duplicates during publication. Select the matching branch with the lowest priority; array order, map iteration, completion order, and visual position never break a tie.

Select exactly one matching branch with the lowest priority. If none matches, select the required default. Record the conditional ID and selected label in the trace, then activate its required `next` step.

There is no handler-produced branch result. Only the executor evaluates a declared conditional. The phrase "invalid branch result" in Epic 02 is stale and must be removed. Routing can still fail if a committed value cannot be evaluated under the declared operator contract, but a handler never returns a branch label.

Type mismatches and unsupported operators are routing failures. JavaScript coercion must not decide `eq`, `gt`, `contains`, or membership behavior. Each operator needs a total type table in the decision record.

### Structured fan-out and fan-in

A step with more than one entry in `successors` opens a fan-out region. Its successor steps are branch roots. The region closes at one matching fan-in step.

The matching fan-in is the unique first common post-dominator of every branch root. Each branch is single-entry and single-exit, and the fan-in `dependencies` list contains exactly one exit step from each branch. Branches cannot cross or merge before the matching fan-in.

An open fan-out region cannot contain a conditional, a `result` step, or a conditional outcome without `next`. The matching fan-in also cannot own a conditional. Route to a later conditional step if execution needs another decision after joining.

Nested fan-out is valid when each nested region closes before its containing branch reaches the outer fan-in. A fan-in can be a normal task or the selected path's `result` step.

When a fan-out step succeeds, all branch roots become ready in the same scheduler turn. The dispatcher invokes as many handlers as its remaining capacity permits. Pending cohort members start as capacity becomes available. The contract does not promise wall-clock overlap or start order. The fan-in becomes ready only after every listed branch exit commits success.

### Completion

A run succeeds only when one selected explicit `result` step resolves its inputs after all required work on that path settles. A terminal transition is absorbing.

Every conditional branch and default routes through `next`; a conditional cannot directly end a v1 run. A selected path reaches exactly one `result` step. A fan-out path reaches that result only after its matching fan-in. Multiple result steps can exist in the workflow document when they belong to mutually exclusive conditional paths.

Graph validation rejects a result or any other terminal step inside an open fan-out region. It also rejects a fan-out without one matching fan-in. These rules make the run output singular without aggregating unrelated terminal values.

### Sequential loops

A loop resolves its collection and checks `maxIterations` before starting its body. A collection longer than the limit fails without starting iteration zero.

Iterations execute in collection order. Iteration $n + 1$ cannot start until iteration $n$ reaches one valid terminal body output and commits it to the loop's result array. Only one iteration is active at a time, although steps inside that iteration can use structured fan-out and fan-in.

Each body step instance is keyed by the loop step ID, iteration index, and body step ID. `loop.<variable>` resolves to the current collection item. The reserved loop output `results` is an array with one terminal output object per collection item in the same order. An explicit empty object is a valid iteration result.

If an iteration fails, the loop and run fail, and no later iteration starts. Sequential execution preserves committed prior results internally. Exposing prior iteration results to a later iteration requires a future reference shape and is not part of v1.

### Failure semantics

Keep invocation problems and accepted-run failures separate.

A failed run exposes a nonempty `failures` array. A queued, running, or succeeded run exposes an empty array. Each failure entry contains these fields:

| Field | Meaning |
| --- | --- |
| `code` | Stable machine-readable identity. Message wording can change. |
| `message` | Safe human explanation. |
| `phase` | `binding`, `handler`, `routing`, `output`, `loop`, `scheduler`, or another approved phase. |
| `runId` | Accepted run identity. |
| `stepId` | Producing or consuming step when applicable. |
| `conditionalId` | Conditional when routing failed. |
| `path` | Workflow or invocation JSON Pointer when a field caused the failure. |
| `details` | JSON object with expected and received values, identifiers, and related context. |

Do not expose stack traces, arbitrary thrown objects, credentials, handler inputs, or complete outputs in the public failure. Log the internal cause separately.

Use stable families rather than one generic executor error:

- `run.binding.*` for unavailable references and scope errors;
- `run.handler.*` for explicit handler failure, throw, and malformed outcome;
- `run.output.*` for missing, unknown, non-JSON, and schema-invalid output;
- `run.routing.*` for condition evaluation and branch selection;
- `run.loop.*` for collection and iteration contract failures;
- `run.scheduler.*` for deadlock and internal invariant failures.

An unhandled failure is sticky. No result step, cleanup step, or later successful handler can turn that run into success.

### Failure with concurrent work

Use fail-fast scheduling with a defined drain boundary:

1. When the reducer observes the first unhandled failure, stop dispatching new work.
2. Let handlers that are already running finish in Epic 02. The reference handlers have no side effects and no cancellation contract.
3. Ignore successful outputs for routing after failure observation, but retain their trace outcome for diagnosis.
4. After active handlers drain, retain every observed failure. Sort the public array by stable step-instance identity, then code and path, so completion timing cannot reorder the response.
5. Move the public run from `running` to `failed` once.

There is no primary failure. The proof completes concurrent failures in both orders and returns the same two-entry failure array. Pending handlers that were not dispatched before failure observation do not run and therefore cannot contribute a failure.

This policy matches Argo's "stop scheduling, let running work finish" boundary and avoids AWS Step Functions' common misunderstanding that stopped orchestration guarantees stopped external work.

### Trace contract

Each transition records an in-memory trace entry with a per-run sequence:

- run queued, running, succeeded, or failed;
- step ready, running, succeeded, or failed;
- conditional branch selected;
- failure observed.

The sequence records observation order. Concurrent completion order is intentionally not deterministic. Sequential and exclusive branch fixtures can assert an exact trace. Parallel fixtures must assert causal constraints and terminal values, not one fabricated total order. For example, a join's `ready` event must follow both dependency success events under every legal completion order.

Epic 03 can persist the same transition records atomically with the run projection and add cursors. E2-S1 does not promise durable or live event delivery.

## Scale and recovery analysis

### Within one daemon

Compile the graph once per published digest into:

- `stepById`;
- `conditionalById`;
- successor lists;
- reverse dependency consumers;
- initial dependency counts;
- parsed binding plans;
- stable topological rank.

Per run, allocate compact state indexed by the compiled step position. Store outputs only for steps that commit them. A ready queue plus a concurrency limit provides backpressure. Dependency-count and edge-maintenance work for a successful finite run is $O(V + E)$, excluding handler work, JSON value size, and any optional ready-work ordering. A FIFO queue preserves that bound because v1 gives parallel successors no execution order. A priority queue adds $O(\log V)$ per operation if a later contract requires ordered dispatch.

The proof completed a 10,000-task chain with 10,001 readiness checks and 10,000 successor-edge visits. It completed a 5,000-way join with 10,003 readiness checks, 5,000 dependency-edge visits, and 10,001 successor-edge visits. These counts establish the algorithmic shape, not a throughput target.

### Across many runs

Runs share immutable compiled plans but never mutable state. A bounded worker pool can dispatch ready steps from many runs fairly. The daemon needs an explicit per-run and global concurrency policy before side-effecting handlers exist, but changing capacity must not change branch choice, bindings, final output, or primary failure selection.

A larger deployment can shard by run ID. Queue messages carry run ID, step-instance ID, attempt ID, and plan identity. Workers load plan data from a cache or shared store. The orchestration owner applies each outcome once. This resembles Conductor's worker boundary and n8n's queue identity model without importing either platform's workflow semantics.

### Epic 03 persistence

The proposed run projection already contains the data Epic 03 says it must preserve:

- exact published workflow identity and digest;
- accepted invocation input;
- step-instance states;
- committed outputs;
- selected branches;
- active and ready work;
- terminal output or failure.

Epic 03 can wrap transitions in transactions and add attempt identity, checkpoint events, commands, and leases. A step output becomes available only after its transition commits. Recovery can reconstruct remaining dependency counts from committed step states or store them as a checked projection.

The design does not promise exactly-once handler execution after recovery. Epic 03 already states that an interrupted attempt may run again. Side-effecting handlers in Epic 04 therefore need idempotency or another delivery contract.

## Decision methodology

The E2-S1 decision record must provide five complementary views.

### 1. State machines

Include separate run and step diagrams. Every arrow names its guard, effect, and failure behavior. State which transitions are internal and which appear through the Control API.

### 2. Transition table

For every transition, record:

| Input | Guard | State changes | Values committed | Work activated | Failure |
| --- | --- | --- | --- | --- | --- |
| Invocation | Exact version, valid inputs, handlers present | Create `queued` run | Workflow identity and inputs | `firstNode` after start | Reject without run |
| Handler success | Step `running`, valid output | Step `succeeded` | Output object | Successors or conditional | Output failure if invalid |
| Handler failure | Step `running` | Step `failed`; run starts stopping | Structured failure | None | Terminal after active drain |
| Branch selection | Owner succeeded; condition total | Record selected branch | Branch label | Selected `next` only | Routing failure |
| Result binding | Result ready; refs resolve | Result and run succeed | Final output | None | Binding failure |

The final record must expand this table for loops and every terminal case.

### 3. Failure catalog

Give each failure code a trigger, phase, required fields, terminal effect, and one example. Prove that message text is not required for automation.

### 4. Example traces

Include sequential, each conditional path, fan-out and fan-in if in scope, success, invocation rejection, binding failure, output failure, handler failure, and concurrent failure. Loop traces are required if the daemon accepts loops.

### 5. Executable reference model

Keep a small pure model beside the decision until implementation replaces it. Run the same fixtures against the model, runtime library, daemon transport, and Control API. Add property checks for:

- terminal states are absorbing;
- a step instance succeeds at most once;
- no handler starts before acceptance or after an observed failure;
- only committed outputs resolve;
- completion order cannot change branch selection or final joined output;
- every accepted valid finite workflow with terminating handlers reaches a terminal state;
- scheduler work is bounded by visited nodes and edges.

The temporary proof at `tmp/e2-s1-poc` covers the first research pass. It is not the production reference model.

## Additional product owner decisions

The product owner resolved Q11 through Q17 after the control-flow decisions.

| ID | Decision | Contract consequence |
| --- | --- | --- |
| Q11 | Only the executor's declared conditional logic selects a branch. There is no handler branch result. | Remove "invalid branch result" terminology. Handler outcomes contain outputs or failure, never a branch label. |
| Q12 | The Control API exposes the execution's current step position. | Use a `currentSteps` array because fan-out can have several ready and running step instances. |
| Q13 | A run has all observed failures or none; no failure is primary. | A failed run returns a stable ordered `failures` array. Fail-fast stops new dispatch and drains active handlers. |
| Q14 | Invocation needs idempotency, owned by Epic 03. | E3-S1 must define the key, duplicate behavior, request mismatch conflict, and durable acceptance boundary. |
| Q15 | Step registry entries include runtime input and output schemas. | E2-S3 owns required and optional handler inputs plus output contracts. |
| Q16 | Invocation rejects undeclared workflow inputs. | Invocation input keys exactly match `workflow.inputs`. |
| Q17 | Handler outputs exactly match their declaration, with static analysis where possible. | Publication compares the concrete registry output schema with the authored declaration; runtime validates returned values and rejects missing or undeclared outputs. |
| Q18 | The matching fan-in step cannot own a conditional. | The fan-in step is a normal task or explicit result step. To branch after joining, route to a separate conditional-owning successor. |
### Proof status

The expanded proof demonstrates the owner-decided behavior:

| Decisions | Proof status |
| --- | --- |
| Q2, Q3, Q9, Q10, Q15, Q16, Q17 | Demonstrated: exact invocation inputs, duplicate-priority rejection, preflight handler support, required and optional handler input contracts, static exact output contracts, and runtime exact output validation. |
| Q4, Q5 | Demonstrated: conditionals and terminals inside fan-out reject; structured branches join once; mutually exclusive conditional paths each reach their own joined result. |
| Q6, Q7 | Demonstrated: one output object per iteration, collection-order execution, maximum one active iteration, ordered results, failure stops later iterations, and structured fan-out works inside each iteration. |
| Q8, Q12 | Demonstrated: capacity one exposes one running and one ready branch; capacity two dispatches both; both produce the same joined output; terminal `currentSteps` is empty. |
| Q11 | Demonstrated: handlers return only outputs or failure; the executor selects the conditional path. |
| Q13 | Demonstrated: opposite concurrent completion orders return the same ordered array containing both observed failures. |
| Q14 | Recorded for E3-S1; durable idempotency proof belongs to Epic 03. |

## Topology decision

**E2-S1-Q18, conditional fan-in:** Can the matching fan-in step itself own a conditional? **Decision:** No. The fan-in is a normal task or explicit result step. To branch after joining, route to a separate conditional-owning successor. This keeps the rule "fan-out cannot connect to a conditional" literal, preserves single-entry single-exit boundaries, and keeps the structured region boundary visible.
## Documents needed to close the spike

With all product-owner questions resolved, E2-S1 delivers these artifacts:

1. The approved decision record at [E2-S1 local execution semantics](../decisions/epic-02/e2-s1-local-execution-semantics.md) defining states, guards, transitions, failure catalog, scale model, required Epic 01 amendments, and Epic 03 handoffs.
2. Complete example execution traces in the decision record for sequential, both conditional branch outcomes, structured fan-out/fan-in, sequential loop success, concurrent failures with drain, invocation rejection, and output schema validation failure.
3. The verified proof of concept at [E2-S1 proof of concept](../results/epic-02/e2-s1-proof-of-concept.md) and `tmp/e2-s1-poc` demonstrating all approved constructs and scale bounds.
4. Updated task specifications across Epic 02 and Epic 03 reconciling implementation scope with the approved execution semantics.
5. Inputs for E2-02's executable-workflow specification and shared fixture schema.
## Primary sources

- [AWS Step Functions error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [AWS Step Functions Choice state](https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html)
- [AWS Step Functions Parallel state](https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html)
- [AWS Step Functions input and output processing](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-input-output-filtering.html)
- [Temporal Workflow Execution](https://docs.temporal.io/workflow-execution)
- [Temporal failures and error handling](https://docs.temporal.io/encyclopedia/failures-and-error-handling)
- [Apache Airflow task lifecycle](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/tasks.html)
- [Apache Airflow DAG-run outcomes](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html)
- [Argo Workflows DAG execution](https://argo-workflows.readthedocs.io/en/latest/walk-through/dag/)
- [Argo Workflows enhanced dependencies](https://argo-workflows.readthedocs.io/en/latest/enhanced-depends-logic/)
- [Prefect states](https://docs.prefect.io/v3/concepts/states)
- [Prefect tasks and dependency resolution](https://docs.prefect.io/v3/concepts/tasks)
- [Conductor OSS task lifecycle](https://conductor-oss.github.io/conductor/devguide/architecture/tasklifecycle.html)
- [Camunda 8 process execution](https://docs.camunda.io/docs/components/concepts/processes/)
- [Camunda 8 incidents](https://docs.camunda.io/docs/components/concepts/incidents/)
- [Azure Durable Task error handling](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-error-handling)
- [n8n execution order](https://docs.n8n.io/build/flow-logic/understand-execution-order)
- [n8n queue mode](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode)
