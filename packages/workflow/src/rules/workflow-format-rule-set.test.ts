import { describe, expect, test } from "bun:test";
import { V1_RULE_SET } from "./v1";
import { WorkflowFormatRegistry, type WorkflowFormatRuleSet } from "./workflow-format-rule-set";

describe("WorkflowFormatRegistry", () => {
    test("selects a rule set by exact version match", () => {
        const registry = new WorkflowFormatRegistry([V1_RULE_SET]);
        expect(registry.select("v1")).toBe(V1_RULE_SET);
        expect(registry.select("v2")).toBeUndefined();
        expect(registry.select("V1")).toBeUndefined();
    });

    test("lists supported versions sorted", () => {
        const registry = new WorkflowFormatRegistry([V1_RULE_SET]);
        expect(registry.versions()).toEqual(["v1"]);
    });

    test("freezes registered rule sets", () => {
        const registry = new WorkflowFormatRegistry([]);
        registry.register(V1_RULE_SET);
        expect(Object.isFrozen(registry.select("v1"))).toBe(true);
    });

    test("keeps rule sets independent of registration order", () => {
        const later: WorkflowFormatRuleSet = { ...V1_RULE_SET, version: "v2" };
        const registry = new WorkflowFormatRegistry([later, V1_RULE_SET]);
        expect(registry.versions()).toEqual(["v1", "v2"]);
        expect(registry.select("v2")).toBe(later);
    });
});
