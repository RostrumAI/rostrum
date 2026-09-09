import { type Finding, sortFindings } from "./findings";
import { JsonSourceParser } from "./parse/json-source-parser";
import { V1_RULE_SET } from "./rules/v1";
import { WorkflowFormatRegistry } from "./rules/workflow-format-rule-set";
import type { SourceMap } from "./source-map";
import { FormatStage } from "./validation/stages/format-stage";
import { ValidationContext } from "./validation/validation-context";
import { ValidationPipeline, type ValidationStage } from "./validation/validation-stage";

/** The result of validating one workflow document. */
export interface ValidationResult {
    /** Findings sorted by pointer then code; empty for a valid document. */
    findings: Finding[];
    /** True when no finding blocks publication. */
    validForPublication: boolean;
}

/**
 * Reads workflow JSON and validates it under the rules selected by its
 * declared `workflowFormatVersion`.
 *
 * Stage 0 parses the raw input (duplicate keys, `NaN`/`Infinity`, and
 * invalid UTF-8 are errors) and stage 1 selects the workflow-format rule set
 * by exact match; the selected rule set then runs its own frozen stages
 * 2 through 8 with prerequisite gating. The same document produces the
 * same ordered findings whether it arrives as text or already parsed;
 * only the line and column numbers differ.
 */
export class WorkflowValidator {
    private readonly registry: WorkflowFormatRegistry;

    /** Constructs a validator over a registry of supported workflow-format rule sets. */
    constructor(registry: WorkflowFormatRegistry) {
        this.registry = registry;
    }

    /**
     * Validates raw workflow JSON given as text or UTF-8 bytes.
     * Parse failures return their findings alone; every later stage is gated.
     */
    validate(input: string | Uint8Array): ValidationResult {
        const parsed = new JsonSourceParser(input).parse();
        if (!parsed.ok) {
            const findings: Finding[] = parsed.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                blocking: true,
                path: issue.path,
                line: issue.line,
                column: issue.column,
                details: issue.details,
            }));
            return this.result(findings);
        }
        return this.validateParsed(parsed.value, parsed.sourceMap);
    }

    /**
     * Validates an already-parsed document.
     * Findings carry no line or column because no source text is available.
     */
    validateDocument(document: unknown): ValidationResult {
        return this.validateParsed(document, null);
    }

    /**
     * Runs the format stage over the rule-set registry, then the selected
     * rule set's stages. An unknown version runs the format stage alone,
     * so its finding is the only output.
     */
    private validateParsed(document: unknown, sourceMap: SourceMap | null): ValidationResult {
        const context = new ValidationContext(document, sourceMap);
        const declared = declaredWorkflowFormatVersion(document);
        const stages: ValidationStage[] = [new FormatStage(this.registry)];
        const selected = typeof declared === "string" ? this.registry.select(declared) : undefined;
        if (selected) {
            stages.push(...selected.stages);
        }
        return this.result(new ValidationPipeline(stages).run(context));
    }

    private result(findings: Finding[]): ValidationResult {
        const sorted = sortFindings(findings);
        return {
            findings: sorted,
            validForPublication: !sorted.some((finding) => finding.blocking),
        };
    }
}

/** Reads the declared `workflowFormatVersion` member when the document is a JSON object. */
function declaredWorkflowFormatVersion(document: unknown): unknown {
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
        return undefined;
    }
    return (document as Record<string, unknown>).workflowFormatVersion;
}

/** Creates a validator that supports workflow format v1. */
export function createWorkflowValidator(): WorkflowValidator {
    return new WorkflowValidator(new WorkflowFormatRegistry([V1_RULE_SET]));
}
