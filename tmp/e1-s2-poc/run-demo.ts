import { validateWorkflow } from "./poc-b/validator.ts";
import { validatePocA } from "./poc-a/validator.ts";
import * as F from "./shared/fixtures.ts";

type Case = { name: string; workflow: unknown; expectCodes: string[] };

const cases: Case[] = [
  { name: "valid sequential", workflow: F.validSequential(), expectCodes: [] },
  { name: "cycle", workflow: F.cycleWorkflow(), expectCodes: ["workflow.graph.cycle"] },
  { name: "unreachable dependency (merge-after-branch)", workflow: F.unreachableDependency(), expectCodes: ["workflow.graph.unreachable-dependency"] },
  { name: "missing branch target", workflow: F.missingBranchTarget(), expectCodes: ["workflow.reference.unknown-target"] },
  { name: "nested loop", workflow: F.nestedLoopWorkflow(), expectCodes: ["workflow.loop.nested"] },
  { name: "invalid loop bound", workflow: F.invalidLoopBound(), expectCodes: ["workflow.shape.constraint"] },
  { name: "conditional missing dependency", workflow: F.conditionalMissingDependency(), expectCodes: ["workflow.conditional.missing-dependency"] },
  { name: "unterminated path", workflow: F.unterminatedPath(), expectCodes: ["workflow.termination.non-result-terminal"] },
  { name: "conditional ends workflow (valid)", workflow: F.conditionalEndsWorkflow(), expectCodes: [] },
  { name: "unknown step type", workflow: F.unknownStepType(), expectCodes: ["workflow.step.unknown-type"] },
  { name: "ref unknown output", workflow: F.refUnknownOutput(), expectCodes: ["workflow.reference.unknown-output"] },
  { name: "fan-out valid", workflow: F.fanOutWorkflow(), expectCodes: [] },
  { name: "loop body cycle", workflow: F.loopBodyCycle(), expectCodes: ["workflow.graph.cycle"] },
  { name: "invalid JSON", workflow: "NOT_JSON" as unknown, expectCodes: ["workflow.parse.json-invalid"] },
  { name: "unknown interfaceVersion", workflow: { interfaceVersion: "v2", id: F.UUID.wf, name: "x", firstNode: F.UUID.s1, steps: [{ id: F.UUID.s1, type: "task" }] }, expectCodes: ["workflow.version.unknown"] },
];

function pretty(findings: { code: string; path: string; blocking: boolean }[]): string {
  if (findings.length === 0) return "  (no findings)";
  return findings.map((f) => `  - ${f.code} @ ${f.path || "/"} ${f.blocking ? "[blocking]" : "[advisory]"}`).join("\n");
}

console.log("=== POC-B: staged pipeline with prerequisite gating ===\n");
for (const c of cases) {
  const raw = c.name === "invalid JSON" ? "{ not json" : JSON.stringify(c.workflow, null, 2);
  const res = validateWorkflow(raw);
  const codes = res.findings.map((f) => f.code);
  const ok = c.expectCodes.every((ec) => codes.some((cc) => cc === ec || cc.startsWith(ec))) && (c.expectCodes.length === 0 ? res.validForPublication : !res.validForPublication);
  console.log(`${ok ? "✓" : "✗"} ${c.name}: ${res.validForPublication ? "publishable" : "blocked"} (${res.findings.length} findings)`);
  console.log(pretty(res.findings));
  if (!ok) console.log(`    expected to contain: ${c.expectCodes.join(", ")}`);
  console.log();
}

console.log("\n=== POC-A: flat sequential (no gating) ===\n");
for (const c of cases.slice(0, 5)) {
  const raw = JSON.stringify(c.workflow, null, 2);
  const res = validatePocA(raw);
  console.log(`- ${c.name}: ${res.findings.length} findings`);
  console.log(pretty(res.findings));
  console.log();
}

console.log("\n=== Finding shape demo (cycle) ===");
const cycleRaw = JSON.stringify(F.cycleWorkflow(), null, 2);
const cycleRes = validateWorkflow(cycleRaw);
console.log(JSON.stringify(cycleRes.findings[0], null, 2));

console.log("\n=== Line/column demo (invalid JSON location) ===");
const badRaw = `{
  "interfaceVersion": "v1",
  "id": "${F.UUID.wf}",
  "name": "demo",
  "firstNode": "${F.UUID.s1}",
  "steps": [{ "id": "${F.UUID.s1}", "type": "task", "successors": ["not-a-uuid"] }]
}`;
const badRes = validateWorkflow(badRaw);
console.log(JSON.stringify(badRes.findings.find((f) => f.code.includes("format")) ?? badRes.findings[0], null, 2));

console.log("\n=== Prerequisite gating demo ===");
const brokenShape = JSON.stringify({ interfaceVersion: "v1", id: "not-a-uuid", name: "", firstNode: "not-a-uuid", steps: [] }, null, 2);
const gated = validateWorkflow(brokenShape);
console.log(`Shape-broken input yields ${gated.findings.length} findings (later graph stages gated):`);
console.log(pretty(gated.findings));
console.log("All later stages (graph/conditional/termination) were skipped because shape had blocking findings.");
