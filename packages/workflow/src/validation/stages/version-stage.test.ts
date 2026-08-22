import { describe, expect, test } from "bun:test";
import { buildDocument } from "../../../tests/helpers/documents";
import { RuleSetRegistry } from "../../rules/interface-rule-set";
import { V1_RULE_SET } from "../../rules/v1";
import { ValidationContext } from "../validation-context";
import { VersionStage } from "./version-stage";

const registry = new RuleSetRegistry([V1_RULE_SET]);

function run(document: unknown) {
    const context = new ValidationContext(document, null);
    const findings = new VersionStage(registry).run(context);
    return { context, findings };
}

describe("VersionStage", () => {
    test("selects the v1 rule set for an exact match", () => {
        const { context, findings } = run(buildDocument());
        expect(findings).toEqual([]);
        expect(context.ruleSet).toBe(V1_RULE_SET);
    });

    test("reports a missing interfaceVersion at its pointer", () => {
        const document = buildDocument() as Record<string, unknown>;
        delete document.interfaceVersion;
        const { context, findings } = run(document);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.code).toBe("workflow.version.missing");
        expect(findings[0]?.path).toBe("/interfaceVersion");
        expect(findings[0]?.blocking).toBe(true);
        expect(() => context.ruleSet).toThrow(/No interface rule set/);
    });

    test("reports a non-object document at the document root", () => {
        const { findings } = run([1, 2, 3]);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.code).toBe("workflow.version.missing");
        expect(findings[0]?.path).toBe("");
    });

    test("reports unknown versions without falling back, listing supported versions", () => {
        const document = { ...buildDocument(), interfaceVersion: "v2" };
        const { context, findings } = run(document);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.code).toBe("workflow.version.unknown");
        expect(findings[0]?.details).toEqual({ received: "v2", supported: ["v1"] });
        expect(() => context.ruleSet).toThrow(/No interface rule set/);
    });

    test("treats a non-string interfaceVersion as unknown", () => {
        const document = { ...buildDocument(), interfaceVersion: 1 };
        const { findings } = run(document);
        expect(findings[0]?.code).toBe("workflow.version.unknown");
        expect(findings[0]?.details).toEqual({ received: 1, supported: ["v1"] });
    });
});
