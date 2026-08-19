import { validateWorkflow } from "./poc-b/validator.ts";
import * as F from "./shared/fixtures.ts";

function show(title: string, workflow: unknown) {
  const raw = JSON.stringify(workflow, null, 2);
  const res = validateWorkflow(raw);
  console.log(`\n=== ${title} ===`);
  console.log(`Publishable: ${res.validForPublication}, findings: ${res.findings.length}`);
  for (const f of res.findings) {
    console.log(JSON.stringify(f, null, 2));
  }
}

// Each finding denotes *what* failed, *where*, and *structured context* for automated repair — not just "invalid"
show("1. Cycle — denotes the exact loop with step ids", F.cycleWorkflow());
show("2. Unreachable dependency — denotes which dependency and where it was declared, with related location of the source step", F.unreachableDependency());
show("3. Conditional missing dependency — denotes the conditional, the missing step, and the offending ref", F.conditionalMissingDependency());
show("4. Loop nested — denotes outer and inner loop ids", F.nestedLoopWorkflow());
show("5. Ref unknown output — denotes the exact input binding and the undeclared output name", F.refUnknownOutput());
show("6. Unknown step type — denotes the step, the received type, and supported types", F.unknownStepType());

const malformedRef = {
  interfaceVersion: "v1",
  id: F.UUID.wf,
  name: "Bad ref syntax",
  firstNode: F.UUID.s1,
  steps: [
    { id: F.UUID.s1, type: "task", config: { operation: "a" }, outputs: { v: { type: "string" } }, successors: [F.UUID.s2] },
    { id: F.UUID.s2, type: "task", config: { operation: "b" }, inputs: { x: { ref: "step.NOT_A_UUID.v" } } },
  ],
};
show("7. Invalid ref syntax — denotes the exact inputs path and the bad ref string", malformedRef);

const branching = {
  interfaceVersion: "v1",
  id: F.UUID.wf,
  name: "Invalid predicate operator",
  firstNode: F.UUID.s1,
  steps: [
    { id: F.UUID.s1, type: "task", config: { operation: "evaluate" }, outputs: { score: { type: "number" } }, conditional: F.UUID.c1 },
    { id: F.UUID.s2, type: "result", inputs: {} },
    { id: F.UUID.s3, type: "result", inputs: {} },
  ],
  conditionals: [
    {
      id: F.UUID.c1,
      dependencies: [F.UUID.s1],
      branches: [{ label: "bad-op", priority: 0, condition: { ref: `step.${F.UUID.s1}.score`, op: "badOp" as never, value: 10 }, next: F.UUID.s2 }],
      default: { label: "fallback", next: F.UUID.s3 },
    },
  ],
};
show("8. Invalid predicate operator — denotes the branch, the operator, and the conditional id", branching);
