import { describe, expect, test } from "bun:test";
import { buildDocument, resultStep, taskStep } from "../../tests/helpers/documents";
import { sortFindings } from "../findings";
import { RuleSetRegistry } from "../rules/interface-rule-set";
import { V1_RULE_SET } from "../rules/v1";
import { CompatibilityStage } from "./stages/compatibility-stage";
import { VersionStage } from "./stages/version-stage";
import { ValidationContext } from "./validation-context";
import { ValidationPipeline } from "./validation-stage";

function pipeline(): ValidationPipeline {
    return new ValidationPipeline([
        new VersionStage(new RuleSetRegistry([V1_RULE_SET])),
        ...V1_RULE_SET.stages,
    ]);
}

function run(document: unknown) {
    return pipeline().run(new ValidationContext(document, null));
}

describe("ValidationPipeline", () => {
    test("runs every stage for a valid document", () => {
        const task = taskStep();
        const end = resultStep();
        task.successors = [end.id];
        const document = buildDocument({ steps: [task, end], firstNode: task.id });
        expect(run(document)).toEqual([]);
    });

    test("gates graph stages when the shape stage blocks", () => {
        const document = buildDocument({ steps: [taskStep({ id: "not-a-uuid" })] });
        const findings = run(document);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings.every((finding) => finding.code.startsWith("workflow.shape."))).toBe(true);
    });

    test("gates everything when the version stage blocks", () => {
        const document = { ...buildDocument(), interfaceVersion: "v9" };
        const findings = run(document);
        expect(findings.map((finding) => finding.code)).toEqual(["workflow.version.unknown"]);
    });

    test("gates later stages when identity blocks", () => {
        const document = buildDocument({ steps: [taskStep({ type: "no-such-type" })] });
        const findings = run(document);
        expect(findings.map((finding) => finding.code)).toEqual(["workflow.step.unknown-type"]);
    });

    test("emits findings from multiple ungated stages", () => {
        // A dangling successor (identity) and a non-result terminal (termination).
        const danglingTarget = "0192b0a0-7e1d-7000-8000-000000000099";
        const task = taskStep({ successors: [danglingTarget] });
        const document = buildDocument({ steps: [task], firstNode: task.id });
        const codes = run(document).map((finding) => finding.code);
        expect(codes).toContain("workflow.reference.unknown-target");
    });

    test("orders collected findings by pointer then code", () => {
        const document = buildDocument({
            steps: [taskStep({ id: "bad" }), resultStep({ id: "also-bad" })],
        });
        const findings = run(document);
        const paths = sortFindings(findings).map((finding) => finding.path);
        expect(paths).toEqual([...paths].sort());
    });

    test("compatibility stage emits nothing in v1", () => {
        const stage = new CompatibilityStage();
        expect(stage.run(new ValidationContext(buildDocument(), null))).toEqual([]);
    });
});
