import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import Schema from "typebox/schema";
import { findingsFromErrors } from "../src/findings";
import { WorkflowSchema } from "../src/schema";
import { validateWorkflow } from "../src/validate";

const validWorkflow = {
  interfaceVersion: "v1",
  id: "wf-hello",
  name: "Hello",
  createdAt: "2026-08-10T12:00:00.000Z",
  start: "say",
  steps: [
    { id: "say", type: "task", next: "done" },
    { id: "done", type: "result" },
  ],
};

describe("validateWorkflow", () => {
  test("accepts a conforming workflow", () => {
    const result = validateWorkflow(validWorkflow);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("wf-hello");
    }
  });

  test("rejects a workflow with a missing required property", () => {
    const { steps: _omitted, ...withoutSteps } = validWorkflow;
    const result = validateWorkflow(withoutSteps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.keyword);
      expect(codes).toContain("required");
    }
  });

  test("rejects an unknown top-level property (additionalProperties false)", () => {
    const result = validateWorkflow({ ...validWorkflow, bogus: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const finding = findingsFromErrors(result.errors)[0];
      expect(finding?.code).toBe("typebox.additionalProperties");
      expect(finding?.path).toBe("/bogus");
      expect(finding?.blocking).toBe(true);
    }
  });

  test("rejects a bad date-time value", () => {
    const result = validateWorkflow({ ...validWorkflow, createdAt: "not a date" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const finding = findingsFromErrors(result.errors)[0];
      expect(finding?.code).toBe("typebox.format");
    }
  });

  test("rejects a step that matches no union member", () => {
    const result = validateWorkflow({
      ...validWorkflow,
      steps: [{ id: "say", type: "teleport" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.keyword === "anyOf")).toBe(true);
    }
  });

  test("rejects NUL bytes in strings (PostgreSQL cannot store them)", () => {
    const result = validateWorkflow({
      ...validWorkflow,
      name: "bad\u0000name",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const finding = findingsFromErrors(result.errors)[0];
      expect(finding?.code).toBe("typebox.pattern");
      expect(finding?.path).toBe("/name");
    }
  });

  test("rejects an unknown step property inside the union", () => {
    const result = validateWorkflow({
      ...validWorkflow,
      steps: [{ id: "say", type: "task", extra: true }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const finding = findingsFromErrors(result.errors)[0];
      expect(finding?.code).toBe("typebox.additionalProperties");
      expect(finding?.path).toBe("/steps/0/extra");
    }
  });
});

describe("Schema.Compile with native JSON Schema", () => {
  test("compiles and validates a native JSON Schema object", () => {
    const native = {
      type: "object",
      properties: { x: { type: "number" } },
      required: ["x"],
      additionalProperties: false,
    } as const;
    const compiled = Schema.Compile(native);
    expect(compiled.Check({ x: 1 })).toBe(true);
    expect(compiled.Check({ x: "1" })).toBe(false);
    expect(compiled.Check({ x: 1, y: 2 })).toBe(false);
  });

  test("compiles a TypeBox type through the same Schema.Compile path", () => {
    const compiled = Schema.Compile(WorkflowSchema);
    expect(compiled.Check(validWorkflow)).toBe(true);
  });
});

describe("TypeBox schema dialect", () => {
  test("schema serializes to JSON Schema 2020-12 dialect", () => {
    const serialized = JSON.parse(JSON.stringify(WorkflowSchema)) as Record<string, unknown>;
    expect(serialized.type).toBe("object");
    expect(serialized.additionalProperties).toBe(false);
    expect((serialized.required as string[]).sort()).toEqual(
      ["interfaceVersion", "id", "name", "createdAt", "start", "steps"].sort(),
    );
    const props = serialized.properties as Record<string, { format?: string }>;
    expect(props.createdAt?.format).toBe("date-time");
    const steps = props.steps as { items?: { anyOf?: unknown[] } };
    expect(steps.items?.anyOf?.length).toBe(2);
  });

  test("Type namespace produces the same shape", () => {
    const t = Type.Object({ x: Type.Number() }, { additionalProperties: false });
    expect(JSON.parse(JSON.stringify(t))).toEqual({
      type: "object",
      properties: { x: { type: "number" } },
      required: ["x"],
      additionalProperties: false,
    });
  });
});
