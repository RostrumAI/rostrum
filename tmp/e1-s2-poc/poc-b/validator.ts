import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { parse as sourceMapParse } from "json-source-map";
import type { Finding, ValidationResult } from "../shared/types.ts";

// ---------------------------------------------------------------------------
// Schema — TypeBox, JSON Schema 2020-12 compatible, additionalProperties false
// ---------------------------------------------------------------------------

const UUID = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", description: "UUID v7" });

const RefObject = Type.Object({ ref: Type.String({ pattern: "^[^\\u0000]+$" }) }, { additionalProperties: false });

const LoopSchema = Type.Object(
  {
    collection: RefObject,
    maxIterations: Type.Integer({ minimum: 1 }),
    variable: Type.String({ minLength: 1, pattern: "^[^\\u0000]+$" }),
    body: UUID,
  },
  { additionalProperties: false },
);

const StepSchema = Type.Object(
  {
    id: UUID,
    type: Type.String({ minLength: 1 }),
    config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    outputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    successors: Type.Optional(Type.Array(UUID, { minItems: 1 })),
    dependencies: Type.Optional(Type.Array(UUID)),
    conditional: Type.Optional(UUID),
    loop: Type.Optional(LoopSchema),
  },
  { additionalProperties: false },
);

// Condition: permissive at shape stage (Type.Unknown); detailed checks in conditional stage
const BranchSchema = Type.Object(
  {
    label: Type.String({ minLength: 1 }),
    priority: Type.Integer({ minimum: 0 }),
    condition: Type.Unknown(),
    next: Type.Optional(UUID),
  },
  { additionalProperties: false },
);

const DefaultSchema = Type.Object(
  {
    label: Type.String({ minLength: 1 }),
    next: Type.Optional(UUID),
  },
  { additionalProperties: false },
);

const ConditionalSchema = Type.Object(
  {
    id: UUID,
    dependencies: Type.Array(UUID),
    branches: Type.Array(BranchSchema, { minItems: 1 }),
    default: DefaultSchema,
  },
  { additionalProperties: false },
);

const WorkflowSchema = Type.Object(
  {
    interfaceVersion: Type.String(),
    id: UUID,
    name: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    firstNode: UUID,
    inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    steps: Type.Array(StepSchema, { minItems: 1 }),
    conditionals: Type.Optional(Type.Array(ConditionalSchema)),
  },
  { additionalProperties: false },
);

type Workflow = Static<typeof WorkflowSchema>;

// ---------------------------------------------------------------------------
// Finding helpers
// ---------------------------------------------------------------------------

function finding(code: string, message: string, path: string, blocking: boolean, extra: Partial<Finding> = {}): Finding {
  return { code, message, path, blocking, ...extra };
}

function sortFindings(f: Finding[]): Finding[] {
  return [...f].sort((a, b) => (a.path === b.path ? a.code.localeCompare(b.code) : a.path.localeCompare(b.path)));
}

// ---------------------------------------------------------------------------
// Stage orchestration
// ---------------------------------------------------------------------------

type Ctx = {
  raw: string;
  parsed: unknown;
  pointers: Record<string, { value: { line: number; column: number }; valueEnd: { line: number; column: number } }>;
  findings: Finding[];
};

type Stage = {
  id: string;
  prereqs: string[];
  run: (ctx: Ctx, workflow: Workflow | null) => Finding[];
};

const REGISTERED_STEP_TYPES = new Set(["task", "result"]);

// ---------------------------------------------------------------------------
// Location helpers via json-source-map
// ---------------------------------------------------------------------------

function loc(ctx: Ctx, pointer: string): { line: number; column: number } | undefined {
  const p = ctx.pointers[pointer];
  if (!p) return undefined;
  return { line: p.value.line + 1, column: p.value.column + 1 }; // source-map is 0-indexed
}

function withLoc(ctx: Ctx, f: Finding): Finding {
  const l = loc(ctx, f.path);
  if (l) return { ...f, line: l.line, column: l.column };
  return f;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

function stageParse(raw: string): { ctx: Ctx; ok: boolean } {
  try {
    const sm = sourceMapParse(raw);
    return { ctx: { raw, parsed: sm.data, pointers: sm.pointers, findings: [] }, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ctx: { raw, parsed: null, pointers: {}, findings: [finding("workflow.parse.json-invalid", `Invalid JSON: ${msg}`, "", true)] },
      ok: false,
    };
  }
}

const stages: Stage[] = [
  {
    id: "version",
    prereqs: [],
    run(ctx) {
      const doc = ctx.parsed as Record<string, unknown>;
      if (typeof doc.interfaceVersion !== "string") {
        return [withLoc(ctx, finding("workflow.version.missing", "Missing required field: interfaceVersion", "/interfaceVersion", true))];
      }
      if (doc.interfaceVersion !== "v1") {
        return [
          withLoc(
            ctx,
            finding("workflow.version.unknown", `Unknown interfaceVersion "${doc.interfaceVersion}"; supported: "v1"`, "/interfaceVersion", true, {
              details: { received: doc.interfaceVersion, supported: ["v1"] },
            }),
          ),
        ];
      }
      return [];
    },
  },
  {
    id: "shape",
    prereqs: ["version"],
    run(ctx) {
      const errors = [...Value.Errors(WorkflowSchema, ctx.parsed)];
      if (errors.length === 0) return [];
      return errors.map((err) => {
        const path = err.path || "";
        const keyword = (err as { type?: number }).type;
        // Map TypeBox error to stable code by keyword
        const codeMap: Record<string, string> = {
          required: "workflow.shape.required-field",
          additionalProperties: "workflow.shape.unknown-field",
          maxItems: "workflow.shape.constraint",
          minItems: "workflow.shape.constraint",
          minimum: "workflow.shape.constraint",
          minLength: "workflow.shape.constraint",
          pattern: "workflow.shape.format",
          type: "workflow.shape.type",
          format: "workflow.shape.format",
        };
        // Heuristic: derive keyword from message when type unavailable
        let kw = "type";
        if (err.message.includes("required")) kw = "required";
        else if (err.message.includes("additional")) kw = "additionalProperties";
        else if (err.message.includes("pattern")) kw = "pattern";
        const code = codeMap[kw] ?? "workflow.shape.invalid";
        // Detect mutually exclusive control flow later; shape stage only reports schema
        return withLoc(ctx, finding(code, err.message, path || "/", true, { details: { schemaPath: err.schemaPath } }));
      });
    },
  },
  {
    id: "identity",
    prereqs: ["shape"],
    run(ctx, wf) {
      if (!wf) return [];
      const out: Finding[] = [];
      const stepIds = new Map<string, number>();
      wf.steps.forEach((s, i) => {
        const count = stepIds.get(s.id) ?? 0;
        stepIds.set(s.id, count + 1);
        if (count >= 1) {
          out.push(
            withLoc(
              ctx,
              finding("workflow.identity.duplicate-step-id", `Duplicate step id "${s.id}"`, `/steps/${i}/id`, true, {
                details: { duplicateId: s.id },
                relatedLocations: [{ path: `/steps/${wf.steps.findIndex((x) => x.id === s.id)}/id`, message: "first occurrence" }],
              }),
            ),
          );
        }
        // unknown step type
        if (!REGISTERED_STEP_TYPES.has(s.type)) {
          out.push(
            withLoc(
              ctx,
              finding("workflow.step.unknown-type", `Unknown step type "${s.type}"`, `/steps/${i}/type`, true, {
                details: { stepId: s.id, received: s.type, supported: [...REGISTERED_STEP_TYPES] },
              }),
            ),
          );
        }
        // mutual exclusion successors vs conditional
        if (s.successors && s.conditional) {
          out.push(
            withLoc(
              ctx,
              finding("workflow.shape.mutually-exclusive", "Step cannot have both successors and conditional", `/steps/${i}`, true, {
                details: { stepId: s.id },
              }),
            ),
          );
        }
        if (s.loop && s.conditional) {
          out.push(
            withLoc(
              ctx,
              finding("workflow.shape.mutually-exclusive", "Step cannot have both loop and conditional", `/steps/${i}`, true, {
                details: { stepId: s.id },
              }),
            ),
          );
        }
      });
      // firstNode must exist
      if (!stepIds.has(wf.firstNode)) {
        out.push(withLoc(ctx, finding("workflow.identity.first-node-unknown", `firstNode "${wf.firstNode}" does not reference an existing step`, "/firstNode", true, { details: { firstNode: wf.firstNode } })));
      }
      // reference existence for successors/dependencies/loop.body/conditional
      const stepIdSet = new Set(wf.steps.map((s) => s.id));
      wf.steps.forEach((s, i) => {
        (s.successors ?? []).forEach((t, j) => {
          if (!stepIdSet.has(t))
            out.push(withLoc(ctx, finding("workflow.reference.unknown-target", `successors[${j}] "${t}" does not exist`, `/steps/${i}/successors/${j}`, true, { details: { stepId: s.id, target: t, field: "successors" } })));
        });
        (s.dependencies ?? []).forEach((d, j) => {
          if (!stepIdSet.has(d))
            out.push(withLoc(ctx, finding("workflow.reference.unknown-target", `dependencies[${j}] "${d}" does not exist`, `/steps/${i}/dependencies/${j}`, true, { details: { stepId: s.id, target: d, field: "dependencies" } })));
        });
        if ((s as unknown as { loop?: { body: string } }).loop?.body && !stepIdSet.has((s as unknown as { loop: { body: string } }).loop.body)) {
          out.push(withLoc(ctx, finding("workflow.reference.unknown-target", `loop.body "${(s as unknown as { loop: { body: string } }).loop.body}" does not exist`, `/steps/${i}/loop/body`, true, { details: { stepId: s.id, target: (s as unknown as { loop: { body: string } }).loop.body } })));
        }
        if (s.conditional && !stepIdSet.has(s.conditional) && !(wf.conditionals ?? []).some((c) => c.id === s.conditional)) {
          // conditional id references top-level conditionals list
          const condIds = new Set((wf.conditionals ?? []).map((c) => c.id));
          if (!condIds.has(s.conditional))
            out.push(withLoc(ctx, finding("workflow.reference.unknown-target", `conditional "${s.conditional}" does not reference an existing conditional`, `/steps/${i}/conditional`, true, { details: { stepId: s.id, target: s.conditional } })));
        }
      });
      // conditionals id uniqueness + branch/default targets
      const condIds = new Map<string, number>();
      (wf.conditionals ?? []).forEach((c, ci) => {
        if (condIds.has(c.id))
          out.push(withLoc(ctx, finding("workflow.identity.duplicate-conditional-id", `Duplicate conditional id "${c.id}"`, `/conditionals/${ci}/id`, true, { details: { duplicateId: c.id } })));
        else condIds.set(c.id, ci);
        c.branches.forEach((b, bi) => {
          if (b.next && !stepIdSet.has(b.next))
            out.push(withLoc(ctx, finding("workflow.reference.unknown-target", `branches[${bi}].next "${b.next}" does not exist`, `/conditionals/${ci}/branches/${bi}/next`, true, { details: { conditionalId: c.id, target: b.next } })));
        });
        if (c.default.next && !stepIdSet.has(c.default.next))
          out.push(withLoc(ctx, finding("workflow.reference.unknown-target", `default.next "${c.default.next}" does not exist`, `/conditionals/${ci}/default/next`, true, { details: { conditionalId: c.id, target: c.default.next } })));
      });
      return out;
    },
  },
  {
    id: "graph",
    prereqs: ["identity"],
    run(ctx, wf) {
      if (!wf) return [];
      const out: Finding[] = [];
      const stepById = new Map(wf.steps.map((s) => [s.id, s]));
      // maxIterations already validated by shape, but re-check for findings ordering
      wf.steps.forEach((s, i) => {
        const loop = (s as unknown as { loop?: { maxIterations: number } }).loop;
        if (loop && (!Number.isInteger(loop.maxIterations) || loop.maxIterations < 1)) {
          out.push(withLoc(ctx, finding("workflow.loop.invalid-max-iterations", `loop.maxIterations must be an integer >= 1`, `/steps/${i}/loop/maxIterations`, true, { details: { stepId: s.id, received: loop.maxIterations } })));
        }
      });
      // no nested loops
      const bodyIds = new Set(wf.steps.filter((s) => (s as unknown as { loop?: unknown }).loop).map((s) => (s as unknown as { loop: { body: string } }).loop.body));
      // Collect all steps that are reachable as body subgraph; for nested check, any step with loop whose id is inside another body's reachable subgraph is nested
      // Build loop-body reachability map
      function reachableFrom(start: string, successorsOf: (id: string) => string[]): Set<string> {
        const seen = new Set<string>();
        const stack = [start];
        while (stack.length) {
          const cur = stack.pop()!;
          if (seen.has(cur)) continue;
          seen.add(cur);
          for (const nxt of successorsOf(cur)) if (!seen.has(nxt)) stack.push(nxt);
        }
        return seen;
      }
      const loopSteps = wf.steps.filter((s) => (s as unknown as { loop?: { body: string } }).loop);
      for (const ls of loopSteps) {
        const bodyStart = (ls as unknown as { loop: { body: string } }).loop.body;
        const succOf = (id: string) => {
          const st = stepById.get(id);
          if (!st) return [];
          const out: string[] = [...(st.successors ?? [])];
          // conditionals not in loop bodies for v1, but handle
          const cond = wf.conditionals?.find((c) => c.id === (st as unknown as { conditional?: string }).conditional);
          if (cond) {
            for (const b of cond.branches) if (b.next) out.push(b.next);
            if (cond.default.next) out.push(cond.default.next);
          }
          return out;
        };
        const bodyReachable = reachableFrom(bodyStart, succOf);
        for (const memberId of bodyReachable) {
          const member = stepById.get(memberId);
          if (member && (member as unknown as { loop?: unknown }).loop && memberId !== ls.id) {
            const idx = wf.steps.findIndex((s) => s.id === memberId);
            out.push(withLoc(ctx, finding("workflow.loop.nested", `Nested loop not allowed: step "${memberId}" inside loop of "${ls.id}" declares a loop`, `/steps/${idx}/loop`, true, { details: { outerLoop: ls.id, innerLoop: memberId } })));
          }
        }
        // body subgraph must be acyclic
        const bodyEdges = new Map<string, string[]>();
        for (const id of bodyReachable) {
          const st = stepById.get(id)!;
          const succs = [...(st.successors ?? [])].filter((x) => bodyReachable.has(x));
          // include conditional branches that stay inside body
          const cond = wf.conditionals?.find((c) => c.id === (st as unknown as { conditional?: string }).conditional);
          if (cond) {
            for (const b of cond.branches) if (b.next && bodyReachable.has(b.next)) succs.push(b.next);
            if (cond.default.next && bodyReachable.has(cond.default.next)) succs.push(cond.default.next);
          }
          bodyEdges.set(id, succs);
        }
        // DFS cycle detection inside body
        const color = new Map<string, number>();
        let bodyCycle: string[] | null = null;
        function dfs(u: string, path: string[]): boolean {
          color.set(u, 1);
          path.push(u);
          for (const v of bodyEdges.get(u) ?? []) {
            if ((color.get(v) ?? 0) === 1) {
              const idx = path.indexOf(v);
              bodyCycle = path.slice(idx).concat(v);
              return true;
            }
            if ((color.get(v) ?? 0) === 0 && dfs(v, path)) return true;
          }
          color.set(u, 2);
          path.pop();
          return false;
        }
        for (const id of bodyReachable) if ((color.get(id) ?? 0) === 0) dfs(id, []);
        if (bodyCycle) {
          out.push(withLoc(ctx, finding("workflow.graph.cycle", `Loop body subgraph contains a cycle`, `/steps/${wf.steps.findIndex((s) => s.id === ls.id)}/loop/body`, true, { details: { loop: ls.id, cycle: bodyCycle } })));
        }
      }

      // Global cycle detection (successors + conditional branches + loop body as edge)
      const globalEdges = new Map<string, string[]>();
      for (const s of wf.steps) {
        const succs: string[] = [...(s.successors ?? [])];
        const cond = wf.conditionals?.find((c) => c.id === (s as unknown as { conditional?: string }).conditional);
        if (cond) {
          for (const b of cond.branches) if (b.next) succs.push(b.next);
          if (cond.default.next) succs.push(cond.default.next);
        }
        const loop = (s as unknown as { loop?: { body: string } }).loop;
        if (loop?.body) succs.push(loop.body);
        globalEdges.set(s.id, succs);
      }
      {
        const color = new Map<string, number>();
        let cycle: string[] | null = null;
        function dfs(u: string, path: string[]): boolean {
          color.set(u, 1);
          path.push(u);
          for (const v of globalEdges.get(u) ?? []) {
            if ((color.get(v) ?? 0) === 1) {
              const idx = path.indexOf(v);
              cycle = path.slice(idx).concat(v);
              return true;
            }
            if ((color.get(v) ?? 0) === 0 && dfs(v, path)) return true;
          }
          color.set(u, 2);
          path.pop();
          return false;
        }
        for (const s of wf.steps) if ((color.get(s.id) ?? 0) === 0) dfs(s.id, []);
        if (cycle) {
          out.push(withLoc(ctx, finding("workflow.graph.cycle", `Workflow graph contains a cycle`, "", true, { details: { cycle } })));
        }
      }

      // Dependency reachability: every dependency must be reachable on all paths from firstNode
      // Approach: compute dominators by intersecting predecessor path sets (simple for DAG; after cycle check graph is acyclic if no cycle finding, but compute anyway)
      if (!out.some((f) => f.code === "workflow.graph.cycle")) {
        const preds = new Map<string, Set<string>>();
        for (const s of wf.steps) preds.set(s.id, new Set());
        for (const [from, tos] of globalEdges) for (const to of tos) preds.get(to)?.add(from);
        // reachable set from firstNode
        const reachable = reachableFrom(wf.firstNode, (id) => globalEdges.get(id) ?? []);
        // For each step with dependencies, check each dependency is on all paths
        // A node d dominates n if every path from firstNode to n includes d.
        // Compute dominators via iterative dataflow: dom(n) = {n} ∪ (∩ dom(p) for p in preds(n)), dom(firstNode)={firstNode}
        const allNodes = new Set(wf.steps.map((s) => s.id));
        const dom = new Map<string, Set<string>>();
        for (const id of allNodes) dom.set(id, id === wf.firstNode ? new Set([id]) : new Set(allNodes));
        let changed = true;
        while (changed) {
          changed = false;
          for (const id of reachable) {
            if (id === wf.firstNode) continue;
            const predSet = preds.get(id) ?? new Set();
            const predDoms = [...predSet].filter((p) => reachable.has(p)).map((p) => dom.get(p)!);
            if (predDoms.length === 0) continue;
            let inter = new Set(predDoms[0]);
            for (let i = 1; i < predDoms.length; i++) inter = new Set([...inter].filter((x) => predDoms[i].has(x)));
            inter.add(id);
            const cur = dom.get(id)!;
            if (inter.size !== cur.size || [...inter].some((x) => !cur.has(x))) {
              dom.set(id, inter);
              changed = true;
            }
          }
        }
        for (const s of wf.steps) {
          const deps = (s.dependencies ?? []) as string[];
          for (const d of deps) {
            if (!reachable.has(s.id)) continue; // unreachable step handled elsewhere
            const dominates = dom.get(s.id)?.has(d);
            if (!dominates) {
              const idx = wf.steps.findIndex((x) => x.id === s.id);
              out.push(
                withLoc(
                  ctx,
                  finding(
                    "workflow.graph.unreachable-dependency",
                    `Dependency "${d}" is not reachable on all paths from firstNode to "${s.id}" (merge-after-branch restriction)`,
                    `/steps/${idx}/dependencies`,
                    true,
                    { details: { step: s.id, dependency: d }, relatedLocations: [{ path: `/steps/${wf.steps.findIndex((x) => x.id === d)}/id`, message: "dependency step" }] },
                  ),
                ),
              );
            }
          }
        }
      }

      return out;
    },
  },
  {
    id: "conditional",
    prereqs: ["identity", "graph"],
    run(ctx, wf) {
      if (!wf) return [];
      const out: Finding[] = [];
      const stepById = new Map(wf.steps.map((s) => [s.id, s]));
      for (let ci = 0; ci < (wf.conditionals ?? []).length; ci++) {
        const c = wf.conditionals![ci];
        if (c.branches.length === 0) {
          out.push(withLoc(ctx, finding("workflow.conditional.empty-branches", "Conditional must have at least one branch", `/conditionals/${ci}/branches`, true, { details: { conditionalId: c.id } })));
        }
        // every ref in branch conditions must be listed in dependencies
        const refsInConditions = new Set<string>();
        function collectRefs(cond: unknown, path: string) {
          if (cond == null || typeof cond !== "object") return;
          const obj = cond as Record<string, unknown>;
          if ("ref" in obj && typeof obj.ref === "string") {
            refsInConditions.add(obj.ref as string);
            // validate predicate shape
            const op = obj.op as string | undefined;
            const allowed = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "notin", "contains", "truthy", "falsy"]);
            if (!allowed.has(op ?? "")) {
              out.push(withLoc(ctx, finding("workflow.conditional.invalid-operator", `Unknown predicate operator "${op}"`, `/conditionals/${ci}/branches${path}`, true, { details: { conditionalId: c.id, operator: op } })));
            }
            // ref must be step.<uuid>.<output>
            const m = (obj.ref as string).match(/^step\.([0-9a-f-]{36})\.([^.]+)$/);
            if (!m) {
              out.push(withLoc(ctx, finding("workflow.conditional.invalid-ref", `Condition ref must be "step.<uuid>.<output>"`, `/conditionals/${ci}/branches${path}`, true, { details: { ref: obj.ref } })));
            } else {
              const sid = m[1];
              if (!stepById.has(sid)) {
                out.push(withLoc(ctx, finding("workflow.conditional.unknown-step", `Condition references unknown step "${sid}"`, `/conditionals/${ci}/branches${path}`, true, { details: { stepId: sid } })));
              }
            }
          }
          if (Array.isArray(obj.all)) obj.all.forEach((child, idx) => collectRefs(child, `${path}/all/${idx}`));
          if (Array.isArray(obj.any)) obj.any.forEach((child, idx) => collectRefs(child, `${path}/any/${idx}`));
        }
        c.branches.forEach((b, bi) => collectRefs(b.condition, `/${bi}/condition`));
        // check dependency coverage: each referenced step id must be in c.dependencies
        const condDepSet = new Set(c.dependencies);
        for (const ref of refsInConditions) {
          const m = ref.match(/^step\.([0-9a-f-]{36})\./);
          if (m) {
            const sid = m[1];
            if (!condDepSet.has(sid)) {
              out.push(
                withLoc(
                  ctx,
                  finding(
                    "workflow.conditional.missing-dependency",
                    `Step "${sid}" referenced in condition but not listed in conditional dependencies`,
                    `/conditionals/${ci}/dependencies`,
                    true,
                    { details: { conditionalId: c.id, referencedStep: sid, ref }, relatedLocations: [{ path: `/conditionals/${ci}/branches`, message: `references ${ref}` }] },
                  ),
                ),
              );
            }
          }
        }
        // dependencies must be steps that exist (already checked) and must complete before conditional step — advisory here, but blocking if missing
        // default presence already enforced by schema (required), but double-check
      }
      // step that references conditional must be valid: conditional's dependencies should be upstream — checked in data-ref stage
      return out;
    },
  },
  {
    id: "termination",
    prereqs: ["graph", "conditional"],
    run(ctx, wf) {
      if (!wf) return [];
      const out: Finding[] = [];
      const stepById = new Map(wf.steps.map((s) => [s.id, s]));
      const globalEdges = new Map<string, string[]>();
      const reverseDeps = new Map<string, string[]>();
      for (const s of wf.steps) {
        const succs: string[] = [...(s.successors ?? [])];
        const cond = wf.conditionals?.find((c) => c.id === (s as unknown as { conditional?: string }).conditional);
        if (cond) {
          for (const b of cond.branches) if (b.next) succs.push(b.next);
          if (cond.default.next) succs.push(cond.default.next);
        }
        const loop = (s as unknown as { loop?: { body: string } }).loop;
        if (loop?.body) succs.push(loop.body);
        globalEdges.set(s.id, succs);
        for (const dep of (s.dependencies ?? []) as string[]) {
          const list = reverseDeps.get(dep) ?? [];
          list.push(s.id);
          reverseDeps.set(dep, list);
        }
      }
      // For termination reachability, implicit edges from dependency sources to dependents model fan-in
      for (const [dep, dependents] of reverseDeps) {
        const existing = globalEdges.get(dep) ?? [];
        for (const d of dependents) if (!existing.includes(d)) existing.push(d);
        if (dependents.length) globalEdges.set(dep, existing);
      }
      const reachable = new Set<string>();
      (function dfs(start: string) {
        const stack = [start];
        while (stack.length) {
          const cur = stack.pop()!;
          if (reachable.has(cur)) continue;
          reachable.add(cur);
          for (const nxt of globalEdges.get(cur) ?? []) if (!reachable.has(nxt)) stack.push(nxt);
        }
      })(wf.firstNode);
      function isTerminalStep(id: string): boolean {
        const s = stepById.get(id)!;
        const hasSuccessors = (s.successors?.length ?? 0) > 0;
        const hasConditional = !!(s as unknown as { conditional?: string }).conditional;
        return !hasSuccessors && !hasConditional;
      }
      function isEndingViaConditional(id: string): boolean {
        const s = stepById.get(id)!;
        const cid = (s as unknown as { conditional?: string }).conditional;
        if (!cid) return false;
        const cond = wf!.conditionals?.find((c) => c.id === cid);
        if (!cond) return false;
        // if any branch or default omits next, that path can end at this step
        return cond.branches.some((b) => !b.next) || !cond.default.next;
      }

      // Enumerate all reachable paths up to visited set to find leaves — since DAG (no cycles), we can DFS to leaves
      const leaves = new Set<string>();
      const visitedPaths = new Set<string>();
      function dfsLeaves(cur: string, path: Set<string>) {
        if (path.has(cur)) return; // cycle guard
        path.add(cur);
        const s = stepById.get(cur);
        if (!s) return;
        const cid = (s as unknown as { conditional?: string }).conditional;
        if (cid) {
          const cond = wf!.conditionals?.find((c) => c.id === cid);
          if (cond) {
            let hasOutgoing = false;
            for (const b of cond.branches) if (b.next) { hasOutgoing = true; dfsLeaves(b.next, new Set(path)); }
            if (cond.default.next) { hasOutgoing = true; dfsLeaves(cond.default.next, new Set(path)); }
            if (!hasOutgoing) { /* all branches end — this is leaf via conditional */ leaves.add(cur); return; }
            // branches that end are leaves too — the conditional step itself is the leaf for those paths
            if (cond.branches.some((b) => !b.next) || !cond.default.next) leaves.add(cur);
            // also need to consider if branches lead elsewhere — those are separate paths already explored
            return;
          }
        }
        const succs = globalEdges.get(cur) ?? [];
        if (succs.length === 0) {
          leaves.add(cur);
          return;
        }
        for (const nxt of succs) dfsLeaves(nxt, new Set(path));
      }
      dfsLeaves(wf.firstNode, new Set());

      for (const leafId of leaves) {
        const s = stepById.get(leafId)!;
        const idx = wf.steps.findIndex((x) => x.id === leafId);
        const terminal = isTerminalStep(leafId);
        const endingBranch = isEndingViaConditional(leafId);
        // Terminal step outside loop body must be typed result
        // We don't have loop membership easily; heuristic: if leaf is terminal and not result, it's invalid unless it's inside loop body
        // Collect body membership
        const loopBodyMembers = new Set<string>();
        for (const ls of wf.steps) {
          const loop = (ls as unknown as { loop?: { body: string } }).loop;
          if (loop?.body) {
            const bodyStart = loop.body;
            const stack = [bodyStart];
            const seen = new Set<string>();
            while (stack.length) {
              const cur = stack.pop()!;
              if (seen.has(cur)) continue;
              seen.add(cur);
              loopBodyMembers.add(cur);
              const curStep = stepById.get(cur);
              if (!curStep) continue;
              for (const nxt of curStep.successors ?? []) if (!seen.has(nxt)) stack.push(nxt);
            }
          }
        }
        const isInsideLoop = loopBodyMembers.has(leafId);
        if (terminal) {
          if (!isInsideLoop && s.type !== "result") {
            out.push(withLoc(ctx, finding("workflow.termination.non-result-terminal", `Reachable terminal step "${leafId}" must be typed "result"`, `/steps/${idx}/type`, true, { details: { stepId: leafId, received: s.type } })));
          }
          // also check that terminal result has no successors/conditional (by definition) — ok
        } else if (endingBranch) {
          // ok — conditional ending is valid regardless of step type
        } else {
          // Should not happen because leaves are defined as terminals or ending-branch, but guard:
          out.push(withLoc(ctx, finding("workflow.termination.unterminated-path", `Reachable path ending at "${leafId}" does not lead to a valid terminal (result step or conditional branch without next)`, `/steps/${idx}`, true, { details: { stepId: leafId } })));
        }
      }

      for (const id of reachable) {
        const s = stepById.get(id);
        if (!s) continue;
        const hasSucc = (s.successors?.length ?? 0) > 0;
        const hasCond = !!(s as unknown as { conditional?: string }).conditional;
        const loop = (s as unknown as { loop?: unknown }).loop;
        if (!hasSucc && !hasCond && !loop) {
        }
      }

      return out;
    },
  },
  {
    id: "dataRefs",
    prereqs: ["identity", "graph"],
    run(ctx, wf) {
      if (!wf) return [];
      const out: Finding[] = [];
      const stepById = new Map(wf.steps.map((s) => [s.id, s]));
      const loopVarScope = new Map<string, string>(); // stepId -> loop variable (for body members)
      // Build map from loop body reachable to its variable
      for (const ls of wf.steps) {
        const loop = (ls as unknown as { loop?: { variable: string; body: string } }).loop;
        if (!loop) continue;
        const stack = [loop.body];
        const seen = new Set<string>();
        while (stack.length) {
          const cur = stack.pop()!;
          if (seen.has(cur)) continue;
          seen.add(cur);
          loopVarScope.set(cur, loop.variable);
          const curStep = stepById.get(cur);
          if (!curStep) continue;
          for (const nxt of curStep.successors ?? []) if (!seen.has(nxt)) stack.push(nxt);
        }
      }

      // Build predecessor reachability for "completes before" check: step A completes before B if A is on all paths to B or is predecessor
      // Simplified: check that referenced step is reachable from firstNode and not downstream of current step (no forward reference)
      // We'll compute topological order attempt
      const inputs = new Set(Object.keys((wf.inputs ?? {}) as Record<string, unknown>));
      wf.steps.forEach((s, si) => {
        const bindings = (s.inputs ?? {}) as Record<string, unknown>;
        for (const [key, val] of Object.entries(bindings)) {
          if (val != null && typeof val === "object" && "ref" in (val as Record<string, unknown>)) {
            const ref = (val as { ref: string }).ref;
            if (typeof ref !== "string") {
              out.push(withLoc(ctx, finding("workflow.reference.invalid-syntax", `Invalid ref value at inputs.${key}`, `/steps/${si}/inputs/${key}`, true, { details: { stepId: s.id, ref } })));
              continue;
            }
            if (ref.startsWith("inputs.")) {
              const name = ref.slice("inputs.".length);
              if (!inputs.has(name)) {
                out.push(withLoc(ctx, finding("workflow.reference.unknown-input", `Reference "${ref}" targets unknown workflow input`, `/steps/${si}/inputs/${key}`, true, { details: { stepId: s.id, ref, input: name } })));
              }
            } else if (ref.startsWith("step.")) {
              const m = ref.match(/^step\.([0-9a-f-]{36})\.([^.]+)$/);
              if (!m) {
                out.push(withLoc(ctx, finding("workflow.reference.invalid-syntax", `Invalid step ref "${ref}"`, `/steps/${si}/inputs/${key}`, true, { details: { stepId: s.id, ref } })));
                continue;
              }
              const [, sid, outName] = m;
              const src = stepById.get(sid);
              if (!src) {
                out.push(withLoc(ctx, finding("workflow.reference.unknown-step", `Reference "${ref}" targets unknown step`, `/steps/${si}/inputs/${key}`, true, { details: { stepId: s.id, ref, targetStep: sid } })));
                continue;
              }
              const declared = (src.outputs ?? {}) as Record<string, unknown>;
              if (!(outName in declared)) {
                out.push(withLoc(ctx, finding("workflow.reference.unknown-output", `Reference "${ref}" targets undeclared output "${outName}"`, `/steps/${si}/inputs/${key}`, true, { details: { stepId: s.id, ref, targetStep: sid, output: outName } })));
              }
              // downstream check: referenced step should not be the current step or downstream; simple check: if current step is reachable from referenced step? Actually need to ensure src can complete before s starts.
              // We'll do: if s is reachable from sid, then src is upstream (ok). If not, may be sibling/future -> error
              // Build global edges for reachability
              const globalEdges = new Map<string, string[]>();
              for (const st of wf.steps) {
                const succs: string[] = [...(st.successors ?? [])];
                const cond = wf.conditionals?.find((c) => c.id === (st as unknown as { conditional?: string }).conditional);
                if (cond) {
                  for (const b of cond.branches) if (b.next) succs.push(b.next);
                  if (cond.default.next) succs.push(cond.default.next);
                }
                const loop = (st as unknown as { loop?: { body: string } }).loop;
                if (loop?.body) succs.push(loop.body);
                globalEdges.set(st.id, succs);
              }
              function isReachable(from: string, to: string): boolean {
                const seen = new Set<string>();
                const stack = [from];
                while (stack.length) {
                  const cur = stack.pop()!;
                  if (cur === to) return true;
                  if (seen.has(cur)) continue;
                  seen.add(cur);
                  for (const nxt of globalEdges.get(cur) ?? []) if (!seen.has(nxt)) stack.push(nxt);
                }
                return false;
              }
              if (sid === s.id) {
              } else if (((s.dependencies ?? []) as string[]).includes(sid)) {
              } else if (!isReachable(sid, s.id) && s.id !== sid) {
                out.push(withLoc(ctx, finding("workflow.reference.not-upstream", `Reference "${ref}" targets step "${sid}" that does not complete before "${s.id}"`, `/steps/${si}/inputs/${key}`, true, { details: { stepId: s.id, ref, targetStep: sid } })));
              }
            } else if (ref.startsWith("loop.")) {
              const v = ref.slice("loop.".length);
              const scopeVar = loopVarScope.get(s.id);
              if (!scopeVar || scopeVar !== v) {
                out.push(withLoc(ctx, finding("workflow.reference.loop-out-of-scope", `Loop variable "${ref}" not in scope for step "${s.id}"`, `/steps/${si}/inputs/${key}`, true, { details: { stepId: s.id, ref, available: scopeVar } })));
              }
            } else {
              out.push(withLoc(ctx, finding("workflow.reference.invalid-syntax", `Unknown ref prefix in "${ref}"`, `/steps/${si}/inputs/${key}`, true, { details: { ref } })));
            }
          }
        }
        // loop collection ref validation
        const loop = (s as unknown as { loop?: { collection: { ref: string } } }).loop;
        if (loop?.collection?.ref) {
          const ref = loop.collection.ref;
          if (ref.startsWith("inputs.")) {
            const name = ref.slice("inputs.".length);
            if (!inputs.has(name)) out.push(withLoc(ctx, finding("workflow.reference.unknown-input", `loop.collection ref "${ref}" targets unknown input`, `/steps/${si}/loop/collection`, true, { details: { stepId: s.id, ref } })));
          } else if (ref.startsWith("step.")) {
            const m = ref.match(/^step\.([0-9a-f-]{36})\.([^.]+)$/);
            if (!m) out.push(withLoc(ctx, finding("workflow.reference.invalid-syntax", `Invalid loop collection ref "${ref}"`, `/steps/${si}/loop/collection`, true, { details: { ref } })));
            else {
              const [, sid, outName] = m;
              const src = stepById.get(sid);
              if (!src) out.push(withLoc(ctx, finding("workflow.reference.unknown-step", `loop.collection "${ref}" targets unknown step`, `/steps/${si}/loop/collection`, true, { details: { ref } })));
              else {
                // allow self-reference for loop step's own output
                if (sid !== s.id) {
                  const declared = (src.outputs ?? {}) as Record<string, unknown>;
                  if (!(outName in declared)) out.push(withLoc(ctx, finding("workflow.reference.unknown-output", `loop.collection "${ref}" targets undeclared output`, `/steps/${si}/loop/collection`, true, { details: { ref, output: outName } })));
                }
              }
            }
          } else {
            out.push(withLoc(ctx, finding("workflow.reference.invalid-syntax", `Unknown loop collection ref "${ref}"`, `/steps/${si}/loop/collection`, true, { details: { ref } })));
          }
        }
      });
      return out;
    },
  },
  {
    id: "ioCompatibility",
    prereqs: ["dataRefs"],
    run(ctx, wf) {
      if (!wf) return [];
      // v1: static I/O compatibility is limited to ref existence checks already done.
      // Type compatibility is advisory, not blocking: compare output schema `type` keyword when both sides declare it.
      // This stage demonstrates the limit without blocking publication.
      const out: Finding[] = [];
      const stepById = new Map(wf.steps.map((s) => [s.id, s]));
      wf.steps.forEach((s, si) => {
        const bindings = (s.inputs ?? {}) as Record<string, unknown>;
        for (const [key, val] of Object.entries(bindings)) {
          if (val != null && typeof val === "object" && "ref" in (val as Record<string, unknown>)) {
            const ref = (val as { ref: string }).ref;
            const m = ref.match(/^step\.([0-9a-f-]{36})\.([^.]+)$/);
            if (!m) continue;
            const [, sid, outName] = m;
            const src = stepById.get(sid);
            if (!src) continue;
            const outSchema = ((src.outputs ?? {}) as Record<string, { type?: string }>)[outName];
            // target's expected schema is not declared anywhere for `task` inputs — no schema to compare. So skip unless we infer.
            // For demonstration, if output type is string but input key suggests number, we cannot know. So v1 declares: no blocking type check.
            // Emit advisory if output declares `type: number` but consumer is `result` with no schema — not actionable.
            // Therefore this stage emits zero blocking findings by design; it exists to document the boundary.
            // Example advisory (non-blocking) if both schemas declare conflicting primitive types and we have a convention: disabled.
            void outSchema;
          }
        }
      });
      return out;
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateWorkflow(raw: string): ValidationResult {
  const parsed = stageParse(raw);
  if (!parsed.ok) return { findings: sortFindings(parsed.ctx.findings), validForPublication: false };
  const ctx: Ctx = parsed.ctx;
  const wf = ctx.parsed as Workflow;

  // Track which stages are blocked
  const blockedStages = new Set<string>();
  // seed with version check: if parse failed, all blocked
  const allFindings: Finding[] = [...ctx.findings];

  for (const stage of stages) {
    const prereqBlocked = stage.prereqs.some((p) => blockedStages.has(p));
    if (prereqBlocked) continue;
    const findings = stage.run(ctx, wf);
    allFindings.push(...findings);
    if (findings.some((f) => f.blocking)) blockedStages.add(stage.id);
  }

  // Stable ordering
  const sorted = sortFindings(allFindings);
  return { findings: sorted, validForPublication: !sorted.some((f) => f.blocking) };
}
