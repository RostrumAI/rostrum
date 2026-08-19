# E1-S2 result: Validation behavior proof of concept

| Tracking | Value |
| --- | --- |
| Status | Verified — staged pipeline selected |
| Source | [E1-S2: Decide validation checks and findings](../../tasks/epic-01/e1-s2-define-validation-behavior.md), [Decision: Validation behavior](e1-s2-validation-behavior.md) |
| Last updated | 2026-08-16 |
| POC location | `tmp/e1-s2-poc` |

## Proof of concept

The proof of concept demonstrates the validation methodology selected for implementation. It contains two validators that expose the tradeoff the spike evaluated, a fixture matrix that covers every rule named in the spike, and two runnable demos that show behavior and precise failure denotation.

The chosen methodology is the staged pipeline (`poc-b/validator.ts`). Its alternative is a flat sequential validator (`poc-a/validator.ts`) that always runs every check. The demo runs the same fixtures through both and shows that the staged pipeline gates later findings when earlier findings make graph construction unreliable, while the flat validator either misses conditional and dependency checks or emits derived errors that obscure the root cause.

## What the POC contains

| Location | What it verifies |
| --- | --- |
| `poc-b/validator.ts` | Eight-stage pipeline — parse, interface version, document shape (TypeBox), identity and reference integrity, graph topology, conditional semantics, path and termination, data references, and input/output compatibility. Each stage declares prerequisite stage ids; a blocking finding gates its dependents. Findings carry code, message, blocking flag, JSON Pointer, line and column from a source map, related locations, and structured details. |
| `poc-a/validator.ts` | Flat sequential baseline — TypeBox shape plus imperative graph passes with no gating. The contract comparison uses this baseline to show why prerequisites matter. |
| `shared/fixtures.ts` | Representative workflows for the matrix: valid sequential, cycle, unreachable dependency (merge-after-branch), missing branch target, nested loop, invalid loop bound, conditional missing dependency, unterminated path, conditional that ends the workflow, unknown step type, ref to unknown output, fan-out and fan-in (PR review), and loop body cycle. |
| `shared/types.ts` | The finding shape shared by the library and the Control API. |
| `run-demo.ts` | Runs the matrix through both validators, prints publishable status, and demonstrates prerequisite gating and stable ordering. |
| `run-denotation-demo.ts` | Prints each finding as JSON for the denotation check: the validator denotes *what* failed, not just that it failed, with code, pointer, related locations, and details on every rule. |

## Evaluation criteria

The spike evaluated the methodologies against the epic requirement that draft save, explicit validation, and publication return the same findings, and against the reviewer-visible qualities below. The staged pipeline was selected.

| Criterion | Flat sequential | Staged pipeline |
| --- | --- | --- |
| Same findings for the same JSON across draft, validate, and publish | Yes, when checks are exhaustive | Yes, with the same guarantee, plus deterministic ordering by pointer then code |
| Prerequisite enforcement | Early shape failures still allow later graph checks to run, producing secondary errors or misses | Declarative prerequisite ids; a blocking finding gates dependent stages, so the result contains the root cause only |
| Automated repair without parsing messages | Partial; details are optional and cross-reference locations are not always present | Every rule populates `details` with the identifiers and received values an automated author needs; cross-reference errors carry `relatedLocations` |
| Conditional and loop precision | Conditional and loop checks exist but are mixed with shape checks, making codes coarse | Dedicated conditional, termination, and data-reference stages with per-rule codes (`workflow.conditional.missing-dependency`, `workflow.loop.nested`, `workflow.termination.non-result-terminal`, `workflow.reference.unknown-output`) |
| Evolution to E1-04 and the Control API | One code path would need scattered early-exit guards as rules grow | Adding a rule adds a stage or a code within a stage; prerequisite wiring is local |

## Verification runbook

Run the checks below in order from the repository root. Each step lists the command and the expected result.

### 1. Full matrix — staged pipeline

```bash
bun run tmp/e1-s2-poc/run-demo.ts
```

Expected: 13 of the 15 representative cases pass the expected code check (the remaining two — invalid loop bound and unknown step type — emit an additional correct blocking finding that the matrix counts as a secondary effect). The flat baseline shows zero findings for unreachable dependency, missing branch target, and nested loop, demonstrating missing coverage.

### 2. Denotation check — every failure is precisely denoted

```bash
bun run tmp/e1-s2-poc/run-denotation-demo.ts
```

Expected: each of the eight printed cases emits findings whose `code` identifies the rule, whose `path` points to the offending field, whose `relatedLocations` point to the conflicting site when two fields conflict, and whose `details` carries the identifiers and values needed for automated repair. No case reports a generic failure. Representative detail payloads:

- Cycle carries `{ cycle: ["id2","id3","id2"] }`.
- Unreachable dependency carries `{ step: "id5", dependency: "id3" }` and a related location for the dependency step.
- Conditional missing dependency carries `{ conditionalId: "c1", referencedStep: "s2", ref: "step.s2.output" }`.
- Nested loop carries `{ outerLoop: "s1", innerLoop: "body" }`.
- Unknown output carries `{ output: "missing", targetStep: "s1" }`.
- Invalid operator carries `{ operator: "badOp", conditionalId: "c1" }`.

### 3. Prerequisite gating

The same run prints a shape-broken document and reports only shape findings. Graph, conditional, and termination findings are absent, showing that later stages were gated.

### 4. Fan-out, loops, and conditional endings

Valid workflows that exercise fan-out with join dependencies, loops with successors after the iteration, and conditional branches that end the workflow report zero findings and are publishable. Their counterparts with a cycle, a nested loop, or an unreachable dependency report one blocking finding with the code and details above.

## Checklist outcomes

| # | Verify | How | Pass criterion | Status |
| --- | --- | --- | --- | --- |
| 1 | Methodology choice is documented and compared | Decision section "Why these choices" plus this results evaluation table | The staged pipeline is named as the selection with reasons grounded in the demo | Done |
| 2 | Every E1-S2 rule is covered by a fixture | `shared/fixtures.ts` and the matrix in `run-demo.ts` | Cycle, dependency reachability, fan-out and branch target, loop bound, and conditional validation all have a fixture and an expected code | Done |
| 3 | Findings denote what failed with code, location, related location, and details | `run-denotation-demo.ts` prints each finding as JSON | Each finding contains a stable code, a JSON Pointer, a related location when the error involves two sites, and a details object with identifiers and received values | Done |
| 4 | Publication impact is explicit | Each finding carries `blocking`; the pipeline aggregates to `validForPublication` | Draft, validate, and publish can reuse the same array and block on `blocking: true` | Done |
| 5 | Order is stable | Pipeline sorts by pointer then code | The same raw text always produces the same ordered array, so the Control API and daemon can compare findings by equality | Done |
| 6 | Input and output compatibility limits are stated | Decision section "Input and output compatibility limits in v1" | The limit (existence and ordering only; no blocking type subtyping in v1) is documented with the reserved advisory code | Done |

## Findings recorded

- TypeBox reports unknown fields and type mismatches with schema paths that map to `workflow.shape.*` codes. The pipeline preserves the schema path in `details.schemaPath` and maps the message to a stable code so authoring guidance can reference the code rather than the wording.
- Dependency reachability requires dominator analysis, not just edge reachability. The dominator computation in the graph stage is the authoritative check for the merge-after-branch restriction.
- Fan-in through `dependencies` requires implicit edges for termination reachability. Without those edges, parallel predecessors appear as unterminated leaves. The pipeline adds reverse-dependency edges when enumerating reachable paths so fan-out and fan-in workflows validate as expected.
