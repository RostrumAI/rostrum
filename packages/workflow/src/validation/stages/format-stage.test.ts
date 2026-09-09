import { describe, expect, test } from "bun:test";
import { V1_RULE_SET } from "../../rules/v1";
import { WorkflowFormatRegistry } from "../../rules/workflow-format-rule-set";
import { buildDocument } from "../../testing/documents";
import { ValidationContext } from "../validation-context";
import { FormatStage } from "./format-stage";

const registry = new WorkflowFormatRegistry([V1_RULE_SET]);

function run(document: unknown) {
    const context = new ValidationContext(document, null);
    const findings = new FormatStage(registry).run(context);
    return { context, findings };
}

describe("FormatStage", () => {
    test("selects the v1 rule set for an exact match", () => {
        const { context, findings } = run(buildDocument());
        expect(findings).toEqual([]);
        expect(context.ruleSet).toBe(V1_RULE_SET);
    });

    test("reports a missing workflowFormatVersion at its pointer", () => {
        const document = buildDocument() as Record<string, unknown>;
        delete document.workflowFormatVersion;
        const { context, findings } = run(document);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.code).toBe("workflow.format.missing");
        expect(findings[0]?.path).toBe("/workflowFormatVersion");
        expect(findings[0]?.blocking).toBe(true);
        expect(() => context.ruleSet).toThrow(/No workflow-format rule set/);
    });

    test("reports a non-object document at the document root", () => {
        const { findings } = run([1, 2, 3]);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.code).toBe("workflow.format.missing");
        expect(findings[0]?.path).toBe("");
    });

    test("reports unknown versions without falling back, listing supported versions", () => {
        const document = { ...buildDocument(), workflowFormatVersion: "v2" };
        const { context, findings } = run(document);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.code).toBe("workflow.format.unknown");
        expect(findings[0]?.details).toEqual({ received: "v2", supported: ["v1"] });
        expect(() => context.ruleSet).toThrow(/No workflow-format rule set/);
    });

    test("treats a non-string workflowFormatVersion as unknown", () => {
        const document = { ...buildDocument(), workflowFormatVersion: 1 };
        const { findings } = run(document);
        expect(findings[0]?.code).toBe("workflow.format.unknown");
        expect(findings[0]?.details).toEqual({ received: 1, supported: ["v1"] });
    });
});
