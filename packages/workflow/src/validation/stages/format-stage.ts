import type { Finding } from "../../findings";
import type { WorkflowFormatRegistry } from "../../rules/workflow-format-rule-set";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";

/**
 * Stage 1: selects the workflow-format rule set for the declared
 * `workflowFormatVersion` by exact match.
 *
 * A missing `workflowFormatVersion` is `workflow.format.missing`; a token no
 * registered rule set claims is `workflow.format.unknown` with the
 * supported versions in `details`. Both are blocking, and every later
 * stage is gated on this one, so an unknown version never falls back to
 * another rule set.
 */
export class FormatStage implements ValidationStage {
    readonly id = "format";
    readonly prerequisites: readonly string[] = [];

    private readonly registry: WorkflowFormatRegistry;

    /** Constructs the stage over the registry of supported rule sets. */
    constructor(registry: WorkflowFormatRegistry) {
        this.registry = registry;
    }

    /** Selects the rule set for the document, or reports why selection failed. */
    run(context: ValidationContext): Finding[] {
        const document = context.document;
        if (typeof document !== "object" || document === null || Array.isArray(document)) {
            return [
                context.findings.create({
                    code: "workflow.format.missing",
                    message:
                        "The document is not a JSON object, so workflowFormatVersion is absent",
                    path: "",
                }),
            ];
        }
        const declared = (document as Record<string, unknown>).workflowFormatVersion;
        if (declared === undefined) {
            return [
                context.findings.create({
                    code: "workflow.format.missing",
                    message: "Missing required field: workflowFormatVersion",
                    path: "/workflowFormatVersion",
                }),
            ];
        }
        const selected = typeof declared === "string" ? this.registry.select(declared) : undefined;
        if (!selected) {
            const supported = this.registry
                .versions()
                .map((version) => JSON.stringify(version))
                .join(", ");
            return [
                context.findings.create({
                    code: "workflow.format.unknown",
                    message: `Unknown workflowFormatVersion ${JSON.stringify(declared)}; supported: ${supported}`,
                    path: "/workflowFormatVersion",
                    details: { received: declared, supported: this.registry.versions() },
                }),
            ];
        }
        context.selectRuleSet(selected);
        return [];
    }
}
