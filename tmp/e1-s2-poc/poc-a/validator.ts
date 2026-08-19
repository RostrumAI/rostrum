import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Finding } from "../shared/types.ts";

const UUID = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
const WorkflowSchema = Type.Object(
  {
    interfaceVersion: Type.String(),
    id: UUID,
    name: Type.String({ minLength: 1 }),
    firstNode: UUID,
    inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    steps: Type.Array(
      Type.Object({
        id: UUID,
        type: Type.String(),
        successors: Type.Optional(Type.Array(UUID)),
        dependencies: Type.Optional(Type.Array(UUID)),
        conditional: Type.Optional(UUID),
        loop: Type.Optional(Type.Object({ collection: Type.Object({ ref: Type.String() }), maxIterations: Type.Integer({ minimum: 1 }), variable: Type.String(), body: UUID })),
        inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        outputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
      { minItems: 1 },
    ),
    conditionals: Type.Optional(Type.Array(Type.Object({ id: UUID, dependencies: Type.Array(UUID), branches: Type.Array(Type.Object({ label: Type.String(), priority: Type.Integer({ minimum: 0 }), condition: Type.Unknown(), next: Type.Optional(UUID) })), default: Type.Object({ label: Type.String(), next: Type.Optional(UUID) }) }))),
  },
  { additionalProperties: false },
);

// POC A: flat sequential validation — no prerequisite gating, no source maps, no staged codes.
// This is the "simpler" alternative discussed in the decision: cheap to write, but noisy on bad input
// because later checks run on structurally broken graphs and emit cascading findings.
export function validatePocA(raw: string): { findings: Finding[]; validForPublication: boolean } {
  const findings: Finding[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { findings: [{ code: "workflow.parse.json-invalid", message: String(e), path: "", blocking: true }], validForPublication: false };
  }
  const doc = parsed as Record<string, unknown>;
  if (doc.interfaceVersion !== "v1") {
    findings.push({ code: "workflow.version.unknown", message: `Unknown version ${doc.interfaceVersion}`, path: "/interfaceVersion", blocking: true });
  }
  for (const err of Value.Errors(WorkflowSchema, parsed)) {
    findings.push({ code: "workflow.shape.invalid", message: err.message, path: err.path || "/", blocking: true });
  }
  // Always runs graph checks even if shape already failed — demonstrates noise
  const steps = (doc.steps as unknown[]) ?? [];
  const ids = new Set<string>();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as Record<string, unknown>;
    if (typeof s.id === "string") {
      if (ids.has(s.id)) findings.push({ code: "workflow.identity.duplicate-step-id", message: `duplicate ${s.id}`, path: `/steps/${i}/id`, blocking: true });
      ids.add(s.id);
    }
  }
  // Naive cycle check (only successors)
  const edges = new Map<string, string[]>();
  for (const s of steps as { id: string; successors?: string[] }[]) edges.set(s.id, s.successors ?? []);
  const color = new Map<string, number>();
  let hasCycle = false;
  function dfs(u: string): boolean {
    color.set(u, 1);
    for (const v of edges.get(u) ?? []) {
      if ((color.get(v) ?? 0) === 1) return true;
      if ((color.get(v) ?? 0) === 0 && dfs(v)) return true;
    }
    color.set(u, 2);
    return false;
  }
  for (const s of steps as { id: string }[]) if ((color.get(s.id) ?? 0) === 0) if (dfs(s.id)) hasCycle = true;
  if (hasCycle) findings.push({ code: "workflow.graph.cycle", message: "cycle detected", path: "", blocking: true });

  findings.sort((a, b) => (a.path === b.path ? a.code.localeCompare(b.code) : a.path.localeCompare(b.path)));
  return { findings, validForPublication: !findings.some((f) => f.blocking) };
}
