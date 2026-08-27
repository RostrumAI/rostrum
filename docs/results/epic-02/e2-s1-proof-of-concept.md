# E2-S1 result: Local execution semantics proof of concept

| Tracking | Value |
| --- | --- |
| Status | Verified expanded research result, not an approved decision |
| Source | [E2-S1: Decide how a local run advances](../../tasks/epic-02/e2-s1-define-local-execution-semantics.md) |
| Research | [E2-S1 local execution options](../../research/e2-s1-local-execution-semantics-options.md) |
| Last updated | 2026-08-26 |
| Proof location | `tmp/e2-s1-poc` |

## What the proof establishes

The proof implements the recommended explicit scheduler and transition reducer, a structured fan-out validator, and a focused sequential-loop controller. The execution plan indexes steps, dependency consumers, and conditionals once. Each run then stores activation, readiness, active work, committed outputs, and terminal state separately from the immutable plan.

The proof establishes these properties for the reduced model:

- Invocation input and handler support are checked before acceptance.
- Missing and undeclared invocation inputs are rejected.
- Static handler contracts distinguish required and optional inputs and reject nonexact output declarations.
- Duplicate branch priorities and conditional outcomes without `next` are rejected before execution.
- A conditional or terminal step inside an open fan-out region is rejected.
- A valid fan-out has one matching fan-in with dependencies equal to its branch exits.
- Mutually exclusive conditional paths can each contain a structured fan-out and a distinct joined result.
- An accepted run advances through explicit run and step states.
- A step becomes ready only after it is activated and all declared dependencies succeed.
- Capacity changes handler start width without changing the joined output.
- Capacity-limited fan-out exposes every ready and running step through `currentSteps`.
- Fan-out completion order does not change the joined output.
- Branch selection activates one path and marks the other path `notSelected` at termination.
- Sequential loop iterations start in collection order after the prior result commits.
- Each iteration produces one explicit output object; `{}` is valid.
- Missing references and handler output mismatches produce structured terminal failures.
- If concurrent steps fail in different orders, the same stable ordered failure array contains every observed failure.
- Readiness uses a remaining-dependency counter. It does not rescan every dependency after every completion.

The focused loop proof isolates iteration ordering and failure. The integrated proof composes the same controller with the graph reducer and runs a structured fan-out body in each iteration. The temporary model does not parse an authored `loop` field.

## Proof scenarios

The scripts at `tmp/e2-s1-poc/run-proof.ts`, `tmp/e2-s1-poc/run-loop-proof.ts`, and `tmp/e2-s1-poc/run-integrated-loop-proof.ts` run assertions for each scenario below.

| Scenario | Observed result |
| --- | --- |
| Missing invocation input | Rejected before run creation with `run.input.missing` |
| Undeclared invocation input | Rejected before run creation with `run.input.unknown` |
| Unsupported handler operation | Rejected before run creation with `run.step.unsupported` |
| Static handler contracts | Required inputs, omitted or provided optional inputs, and exact output schemas validated; missing required input and output mismatch produced stable findings |
| Duplicate branch priority | Rejected before run creation with `run.definition.duplicate-branch-priority` |
| Conditional outcome without `next` | Rejected with `run.definition.conditional-terminal` |
| Terminal inside fan-out | Rejected with `run.definition.fanout-terminal` |
| Conditional inside fan-out | Rejected with `run.definition.fanout-conditional` |
| Mutually exclusive joined results | Both conditional choices succeeded in separate runs and selected only their path's joined result |
| Sequential binding | Run succeeded with `{ "greeting": "Hello, Ada" }`; `copy` and `result` succeeded in order |
| Conditional branch | `approved` selected; `approved-path` succeeded; `rejected-path` ended as `notSelected` |
| Fan-out and fan-in | Forward and reverse branch completion both produced `{ "combined": "AB" }` |
| Capacity-bound fan-out | Capacity one dispatched one branch at a time; capacity two dispatched both together; output was identical |
| Current step projection | Capacity one exposed branch `a` as running and branch `b` as ready; terminal `currentSteps` was empty |
| Concurrent failures | Forward and reverse completion both returned the same two-entry failure array containing steps `a` and `b` |
| Explicit handler outputs | Populated outputs and explicit empty `{}` outputs succeeded |
| Invalid handler output | Wrong type, missing declared output, and undeclared output failed with `run.output.type`, `run.output.missing`, and `run.output.unknown` |
| Unresolved runtime binding | Run failed with `run.binding.unresolved-reference` and the consumer input path |
| Sequential loop | Iterations started in order `0, 1, 2`, maximum active iterations was one, and results preserved collection order |
| Integrated loop body | Every sequential iteration dispatched a two-branch structured fan-out, joined once, and returned results in collection order |
| Failed loop iteration | Iterations `0` and `1` ran; iteration `2` did not start after iteration `1` failed |
| Loop bound | A three-item collection with `maxIterations: 2` failed before iteration zero |
| 10,000-task chain | Succeeded; 10,001 readiness checks and 10,000 successor-edge visits |
| 5,000-way join | Succeeded; 10,003 readiness checks, 5,000 dependency-edge visits, and 10,001 successor-edge visits |

The large synthetic cases are structural checks, not latency or throughput benchmarks. Their counters show that graph advancement is proportional to visited steps and edges. They do not establish production capacity.

## Error behavior demonstrated

A failed run contains a nonempty, stable-ordered failure array. Each entry has a code, human message, phase, optional step and document path, and structured details. The proof keeps rejected invocations separate from accepted failed runs.

The observed output-contract failure was:

```json
{
  "code": "run.output.type",
  "message": "Step 'copy' produced the wrong type for output 'greeting'.",
  "phase": "output",
  "details": {
    "output": "greeting",
    "expectedType": "string",
    "receivedType": "number"
  },
  "stepId": "copy"
}
```

The observed binding failure was:

```json
{
  "code": "run.binding.unresolved-reference",
  "message": "Reference 'inputs.absent' has no committed value.",
  "phase": "binding",
  "details": {
    "reference": "inputs.absent"
  },
  "path": "/steps/copy/inputs/missing",
  "stepId": "copy"
}
```

The proof does not expose stack traces through this contract. A production implementation can retain an internal cause for logs while keeping the public failure stable and safe to serialize.

## Scale argument

The model separates four operations:

1. Compile a published workflow into immutable indexes once per digest.
2. Activate a step when a selected connection reaches it.
3. Decrement an integer for each completed dependency edge.
4. Put an activated step in the ready set when its remaining dependency count reaches zero.

Compilation of the execution indexes takes $O(V + E)$ time and space for $V$ steps and $E$ control and dependency edges before any optional ordering of ready work. Dependency-count maintenance across a successful run also takes $O(V + E)$. A scan-all-steps loop would require up to $O(V^2)$ readiness work on a long chain. Rechecking every dependency after each branch completion would do the same on a wide join. The proof uses neither approach. Its ready set sorts step IDs for stable demonstration output, and that sorting cost is not part of the counters. A production FIFO ready queue needs constant-time insertion and removal because v1 gives parallel successors no execution order. A priority queue would add $O(\log V)$ per operation if a later contract requires ordered dispatch.

The proof's structured-region validator favors clarity over asymptotic performance and computes reachability from each fan-out branch. Production validation must compute immediate common post-dominators and single-entry, single-exit regions once for the graph rather than repeat whole-graph searches per branch. This validation cost occurs when the immutable plan is compiled, not on every step transition.

At larger deployment scale, the same transition contract can sit behind a queue or durable store:

- Cache the immutable plan by workflow digest.
- Give each run one serialized transition owner, such as an actor, shard, or compare-and-swap record.
- Dispatch ready step attempts to a bounded worker pool.
- Commit an attempt outcome before decrementing downstream dependency counts.
- Pass run IDs and step-instance IDs through queues instead of copying the workflow document.
- Store large values as artifacts and pass references when the artifact contract exists.

Epic 03 can persist the same projection and transition inputs. It does not need to reinterpret successful runs. Recovery adds attempts, checkpoints, and leases around the reducer.

## Limits

The proof is temporary research code. It does not implement the complete v1 condition operator set, JSON Schema validation, daemon transport, persistence, retries, cancellation, or side effects. It composes the loop controller with graph runs but does not parse the authored `loop` field. Those omissions are implementation and proof boundaries, not evidence that the missing behavior is safe.

The proof uses short fixture IDs instead of UUID v7 values and a reduced type checker instead of the shared TypeBox schemas. Production code must use the workflow package and approved step registry.
All semantic and topology questions are resolved, including Q18: the matching fan-in step cannot own a conditional and branching after fan-in uses a separate successor.

Durable invocation idempotency is assigned to E3-S1. Control API transport, persistence, complete condition operators, authored `loop` parsing, retries, cancellation, and side effects remain outside this temporary proof.

## Verification

Run all proofs from the repository root:

```bash
bun run tmp/e2-s1-poc/run-proof.ts
bun run tmp/e2-s1-poc/run-loop-proof.ts
bun run tmp/e2-s1-poc/run-integrated-loop-proof.ts
```

All commands exit successfully after their assertions pass and print the observed results as JSON. The verified runs produced the successful sequential, conditional, structured fan-out, capacity-bound fan-out, sequential loop, integrated structured loop, 10,000-task chain, and 5,000-way join results listed above. They also produced the stable rejection and failure codes in the scenario table.
