import type { Finding } from "../../findings";
import type { RuleSetRegistry } from "../../rules/interface-rule-set";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";

/**
 * Stage 1: selects the interface rule set for the declared
 * `interfaceVersion` by exact match.
 *
 * A missing `interfaceVersion` is `workflow.version.missing`; a token no
 * registered rule set claims is `workflow.version.unknown` with the
 * supported versions in `details`. Both are blocking, and every later
 * stage is gated on this one, so an unknown version never falls back to
 * another rule set (E1-S1, E1-S4).
 */
export class VersionStage implements ValidationStage {
    readonly id = "version";
    readonly prerequisites: readonly string[] = [];

    private readonly registry: RuleSetRegistry;

    /** Constructs the stage over the registry of supported rule sets. */
    constructor(registry: RuleSetRegistry) {
        this.registry = registry;
    }

    /** Selects the rule set for the document, or reports why selection failed. */
    run(context: ValidationContext): Finding[] {
        const document = context.document;
        if (typeof document !== "object" || document === null || Array.isArray(document)) {
            return [
                context.findings.create({
                    code: "workflow.version.missing",
                    message: "The document is not a JSON object, so interfaceVersion is absent",
                    path: "",
                }),
            ];
        }
        const declared = (document as Record<string, unknown>).interfaceVersion;
        if (declared === undefined) {
            return [
                context.findings.create({
                    code: "workflow.version.missing",
                    message: "Missing required field: interfaceVersion",
                    path: "/interfaceVersion",
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
                    code: "workflow.version.unknown",
                    message: `Unknown interfaceVersion ${JSON.stringify(declared)}; supported: ${supported}`,
                    path: "/interfaceVersion",
                    details: { received: declared, supported: this.registry.versions() },
                }),
            ];
        }
        context.selectRuleSet(selected);
        return [];
    }
}
