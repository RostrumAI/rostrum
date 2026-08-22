import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { StepTypeRegistry } from "./step-type-registry";

describe("StepTypeRegistry", () => {
    test("registers types and reports them sorted", () => {
        const registry = new StepTypeRegistry({ result: {}, task: {} });
        expect(registry.has("task")).toBe(true);
        expect(registry.has("no-such-type")).toBe(false);
        expect(registry.types()).toEqual(["result", "task"]);
    });

    test("exposes the config schema of a registration", () => {
        const schema = Type.Object({ operation: Type.String() });
        const registry = new StepTypeRegistry({ task: { configSchema: schema } });
        expect(registry.registrationFor("task")?.configSchema).toBe(schema);
        expect(registry.registrationFor("result")?.configSchema).toBeUndefined();
    });

    test("defaults a registration without arguments to an empty entry", () => {
        const registry = new StepTypeRegistry();
        registry.register("task");
        expect(registrationIsEmpty(registry, "task")).toBe(true);
    });

    test("refuses registration after seal", () => {
        const registry = new StepTypeRegistry({ task: {} });
        registry.seal();
        expect(() => registry.register("result")).toThrow(/sealed/);
        expect(registry.has("result")).toBe(false);
    });
});

function registrationIsEmpty(registry: StepTypeRegistry, type: string): boolean {
    const registration = registry.registrationFor(type);
    return registration !== undefined && Object.keys(registration).length === 0;
}
