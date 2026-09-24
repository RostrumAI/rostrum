import {
    checkStaticCompatibility,
    STATIC_ISSUE_CODES,
} from "../../compatibility/static-compatibility-check";
import { createDeclaredSchemaCompiler } from "../../declared-schemas/declared-schema-compiler";
import type { Finding } from "../../findings";
import type { OperationCatalog } from "../../operations/operation-catalog";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";

/**
 * Stage 8: input and output compatibility.
 *
 * Runs the shared static compatibility check against the release's
 * operation catalog and reports every issue as a blocking finding: unknown
 * operations (`workflow.operation.unknown`), invalid task configuration
 * (`workflow.operation.invalid-config`), invalid declared schemas and
 * defaults, missing and undeclared arguments, undeclared outputs, bindings
 * whose producer doesn't fit or can't be proven to fit its consumer
 * (`workflow.io.*`), and unsuitable condition operands
 * (`workflow.condition.operand-mismatch`). The daemon reruns the same
 * check when it prepares a publication.
 */
export class InputOutputCompatibilityStage implements ValidationStage {
    readonly id = "compatibility";
    readonly prerequisites: readonly string[] = ["references"];

    private readonly catalog: OperationCatalog;

    /** Constructs the stage over the operation catalog publications are checked against. */
    constructor(catalog: OperationCatalog) {
        this.catalog = catalog;
    }

    /**
     * Reports every static compatibility issue. Each run compiles with a
     * fresh schema compiler, so compiled declarations don't accumulate in
     * the frozen rule set.
     */
    run(context: ValidationContext): Finding[] {
        const issues = checkStaticCompatibility(
            context.typedDocument,
            this.catalog,
            createDeclaredSchemaCompiler(),
        );
        return issues.map((issue) =>
            context.findings.create({
                code: STATIC_ISSUE_CODES[issue.kind].findingCode,
                message: issue.message,
                path: issue.path,
                details: issue.details,
            }),
        );
    }
}
