import {
    type DeclaredSchemaCompiler,
    isJsonSchema,
    type JsonSchema,
} from "../declared-schemas/declared-schema-compiler";
import type { FailureCode } from "../execution/schemas";
import { escapePointerToken } from "../json-source-map";
import {
    type OperationCatalog,
    type OperationDeclaration,
    toJsonSchema,
} from "../operations/operation-catalog";
import { getStepConfig, type WorkflowDocument, type WorkflowStep } from "../schema";
import { isReferenceObject, LOOP_RESULTS_OUTPUT } from "../validation/data-references";

/**
 * The static input/output compatibility check shared by publication and
 * preparation.
 *
 * Every constraint JSON Schema can express is checked wherever the value
 * it applies to is known at publication: task operations and their
 * configuration, declared schemas and defaults, bound and missing
 * arguments, literal bindings, and the names of declared outputs. The
 * Control API reports the issues as stage 8 findings; the daemon reruns
 * the check with its own catalog and refuses the publication with the
 * matching failure codes.
 */

/** The kinds of problem the check reports. */
export type StaticIssueKind =
    | "unknown-operation"
    | "invalid-config"
    | "invalid-schema"
    | "invalid-default"
    | "missing-argument"
    | "undeclared-argument"
    | "undeclared-output"
    | "type-mismatch";

/** The finding code and execution failure code one issue kind maps to. */
export interface StaticIssueCodes {
    /** The blocking validation finding code publication reports. */
    readonly findingCode: string;
    /** The failure code preparation refuses the publication with. */
    readonly failureCode: FailureCode;
}

/** How each issue kind is reported by publication and by preparation. */
export const STATIC_ISSUE_CODES: Readonly<Record<StaticIssueKind, StaticIssueCodes>> = {
    "unknown-operation": {
        findingCode: "workflow.operation.unknown",
        failureCode: "unknown_operation",
    },
    "invalid-config": {
        findingCode: "workflow.operation.invalid-config",
        failureCode: "invalid_config",
    },
    "invalid-schema": { findingCode: "workflow.io.invalid-schema", failureCode: "invalid_schema" },
    "invalid-default": {
        findingCode: "workflow.io.invalid-default",
        failureCode: "invalid_default",
    },
    "missing-argument": {
        findingCode: "workflow.io.missing-argument",
        failureCode: "missing_argument",
    },
    "undeclared-argument": {
        findingCode: "workflow.io.undeclared-argument",
        failureCode: "undeclared_argument",
    },
    "undeclared-output": {
        findingCode: "workflow.io.undeclared-output",
        failureCode: "undeclared_output",
    },
    "type-mismatch": { findingCode: "workflow.io.type-mismatch", failureCode: "io_type_mismatch" },
};

/** One located problem the static check found. */
export interface StaticCompatibilityIssue {
    /** What kind of problem this is; selects the finding and failure codes. */
    kind: StaticIssueKind;
    /** JSON Pointer into the document at the offending value. */
    path: string;
    /** A sanitized, human-readable explanation. */
    message: string;
    /** The step responsible, when one is. */
    stepId?: string;
    /** Structured context an automated author can repair from without parsing the message. */
    details: Record<string, unknown>;
}

/**
 * Runs the static compatibility check over a shape-valid document and
 * returns every issue found. The compiler should be fresh for this run so
 * compiled declarations don't outlive the document.
 */
export function checkStaticCompatibility(
    document: WorkflowDocument,
    catalog: OperationCatalog,
    compiler: DeclaredSchemaCompiler,
): StaticCompatibilityIssue[] {
    return new StaticCompatibilityCheck(document, catalog, compiler).run();
}

/** One run of the static check over one document. */
class StaticCompatibilityCheck {
    private readonly document: WorkflowDocument;
    private readonly catalog: OperationCatalog;
    private readonly compiler: DeclaredSchemaCompiler;
    private readonly issues: StaticCompatibilityIssue[] = [];

    /** Binds the check to one document, a catalog, and a compiler. */
    constructor(
        document: WorkflowDocument,
        catalog: OperationCatalog,
        compiler: DeclaredSchemaCompiler,
    ) {
        this.document = document;
        this.catalog = catalog;
        this.compiler = compiler;
    }

    /** Checks inputs, then each step. */
    run(): StaticCompatibilityIssue[] {
        this.checkWorkflowInputs();
        for (const [index, step] of this.document.steps.entries()) {
            this.checkStep(step, index);
        }
        return this.issues;
    }

    /** Checks that each workflow input schema compiles and its default satisfies it. */
    private checkWorkflowInputs(): void {
        for (const [name, declaration] of Object.entries(this.document.inputs ?? {})) {
            const pointer = `/inputs/${escapePointerToken(name)}`;
            const schema = declaration.schema;
            if (!this.schemaCompiles(schema, `${pointer}/schema`, undefined, { input: name })) {
                continue;
            }
            if (Object.hasOwn(declaration, "default")) {
                this.checkDefault(schema, declaration.default, `${pointer}/default`, undefined, {
                    input: name,
                });
            }
        }
    }

    /** Checks one step's operation, configuration, declared outputs, and bindings. */
    private checkStep(step: WorkflowStep, index: number): void {
        const pointer = `/steps/${index}`;

        // Declared output schemas must compile whatever the step type.
        for (const [name, schema] of Object.entries(step.outputs ?? {})) {
            const path = `${pointer}/outputs/${escapePointerToken(name)}`;
            this.schemaCompiles(schema, path, step.id, { output: name });
        }

        // A result step's resolved inputs are the run's result, so it produces no outputs to
        // declare, and its bindings have no consumer.
        if (step.type === "result") {
            for (const name of Object.keys(step.outputs ?? {})) {
                this.report(
                    "undeclared-output",
                    `${pointer}/outputs/${escapePointerToken(name)}`,
                    "A result step produces no outputs other steps can bind to",
                    step.id,
                    { output: name },
                );
            }
            return;
        }
        if (step.type !== "task") {
            return;
        }
        const operation = this.getTaskOperation(step, pointer);
        if (!operation) {
            return;
        }
        this.checkConfig(step, operation, pointer);
        this.checkDeclaredOutputs(step, operation, pointer);
        this.checkArguments(step, operation, pointer);
    }

    /** Finds the task's operation in the catalog, reporting an absent or unknown one. */
    private getTaskOperation(
        step: WorkflowStep,
        pointer: string,
    ): OperationDeclaration | undefined {
        const name = getStepConfig(step).operation;
        const operation = typeof name === "string" ? this.catalog.get(name) : undefined;
        if (operation) {
            return operation;
        }
        this.issues.push({
            kind: "unknown-operation",
            path: typeof name === "string" ? `${pointer}/config/operation` : pointer,
            message:
                typeof name === "string"
                    ? `Operation '${name}' isn't in the operation catalog`
                    : "The task names no operation",
            stepId: step.id,
            details: {
                stepId: step.id,
                operation: typeof name === "string" ? name : null,
                supported: [...this.catalog.keys()].sort(),
            },
        });
        return undefined;
    }

    /** Checks the task's configuration, without `operation`, against the operation's schema. */
    private checkConfig(
        step: WorkflowStep,
        operation: OperationDeclaration,
        pointer: string,
    ): void {
        const { operation: _name, ...config } = getStepConfig(step);
        const compiled = this.compiler.compile(toJsonSchema(operation.configSchema));
        if (!compiled.ok) {
            throw new Error(
                `The catalog's configuration schema for '${operation.name}' doesn't compile`,
            );
        }
        for (const issue of compiled.check(config)) {
            this.issues.push({
                kind: "invalid-config",
                path: `${pointer}/config${issue.path}`,
                message: `Configuration for '${operation.name}' is invalid: ${issue.message}`,
                stepId: step.id,
                details: { stepId: step.id, operation: operation.name, keyword: issue.keyword },
            });
        }
    }

    /**
     * Checks each declared output is a member the operation always returns.
     * A loop step's reserved `results` output is exempt; its declaration
     * only documents the element shape.
     */
    private checkDeclaredOutputs(
        step: WorkflowStep,
        operation: OperationDeclaration,
        pointer: string,
    ): void {
        for (const name of Object.keys(step.outputs ?? {})) {
            if (step.loop && name === LOOP_RESULTS_OUTPUT) {
                continue;
            }
            const path = `${pointer}/outputs/${escapePointerToken(name)}`;
            if (getOperationOutputMember(operation, name) === undefined) {
                this.issues.push({
                    kind: "undeclared-output",
                    path,
                    message: `Operation '${operation.name}' doesn't always return an output named '${name}'`,
                    stepId: step.id,
                    details: { stepId: step.id, operation: operation.name, output: name },
                });
            }
        }
    }

    /** Checks that required arguments are bound, nothing undeclared is, and each literal fits. */
    private checkArguments(
        step: WorkflowStep,
        operation: OperationDeclaration,
        pointer: string,
    ): void {
        const bindings = step.inputs ?? {};

        // Bound names must be arguments the operation declares.
        for (const [name, binding] of Object.entries(bindings)) {
            const path = `${pointer}/inputs/${escapePointerToken(name)}`;
            const argument = Object.hasOwn(operation.arguments, name)
                ? operation.arguments[name]
                : undefined;
            if (!argument) {
                this.issues.push({
                    kind: "undeclared-argument",
                    path,
                    message: `Operation '${operation.name}' has no argument named '${name}'`,
                    stepId: step.id,
                    details: { stepId: step.id, operation: operation.name, argument: name },
                });
                continue;
            }
            if (!isReferenceObject(binding)) {
                this.checkLiteral(step, binding, toJsonSchema(argument.schema), path, name);
            }
        }

        // Every argument must be bound or have a valid default.
        for (const [name, argument] of Object.entries(operation.arguments)) {
            if (Object.hasOwn(bindings, name)) {
                continue;
            }
            if (!Object.hasOwn(argument, "default")) {
                this.issues.push({
                    kind: "missing-argument",
                    path: step.inputs ? `${pointer}/inputs` : pointer,
                    message: `Operation '${operation.name}' requires the argument '${name}'`,
                    stepId: step.id,
                    details: { stepId: step.id, operation: operation.name, argument: name },
                });
                continue;
            }
            this.checkDefault(
                toJsonSchema(argument.schema),
                argument.default,
                `${pointer}/config/operation`,
                step.id,
                {
                    operation: operation.name,
                    argument: name,
                },
            );
        }
    }

    /** Checks a literal binding against its argument's full schema. */
    private checkLiteral(
        step: WorkflowStep,
        binding: unknown,
        consumer: JsonSchema,
        path: string,
        argument: string,
    ): void {
        const compiled = this.compiler.compile(consumer);
        if (!compiled.ok) {
            throw new Error(`The catalog's schema for argument '${argument}' doesn't compile`);
        }
        for (const issue of compiled.check(binding)) {
            this.issues.push({
                kind: "type-mismatch",
                path: `${path}${issue.path}`,
                message: `The literal for '${argument}' doesn't fit the argument: ${issue.message}`,
                stepId: step.id,
                details: { stepId: step.id, argument, keyword: issue.keyword },
            });
        }
    }

    /** Compiles a declared schema, reporting a located invalid-schema issue when it's refused. */
    private schemaCompiles(
        schema: unknown,
        path: string,
        stepId: string | undefined,
        details: Record<string, unknown>,
    ): schema is JsonSchema {
        if (!isJsonSchema(schema)) {
            this.report(
                "invalid-schema",
                path,
                "A schema must be an object or a boolean",
                stepId,
                details,
            );
            return false;
        }
        const compiled = this.compiler.compile(schema);
        if (!compiled.ok) {
            this.report(
                "invalid-schema",
                `${path}${compiled.path}`,
                compiled.message,
                stepId,
                details,
            );
            return false;
        }
        return true;
    }

    /** Records one issue, attributing it to the responsible step when there is one. */
    private report(
        kind: StaticIssueKind,
        path: string,
        message: string,
        stepId: string | undefined,
        details: Record<string, unknown>,
    ): void {
        const issue: StaticCompatibilityIssue = { kind, path, message, details };
        if (stepId !== undefined) {
            issue.stepId = stepId;
            issue.details = { stepId, ...details };
        }
        this.issues.push(issue);
    }

    /** Reports a declared default that doesn't satisfy its own schema. */
    private checkDefault(
        schema: JsonSchema,
        value: unknown,
        path: string,
        stepId: string | undefined,
        details: Record<string, unknown>,
    ): void {
        const compiled = this.compiler.compile(schema);
        if (!compiled.ok) {
            return;
        }
        const first = compiled.check(value)[0];
        if (first) {
            this.report(
                "invalid-default",
                path,
                `The default doesn't satisfy its schema: ${first.message}`,
                stepId,
                { ...details, keyword: first.keyword },
            );
        }
    }
}

/**
 * The schema of an output member the operation always returns, or
 * undefined when the member is optional or absent.
 */
function getOperationOutputMember(
    operation: OperationDeclaration,
    name: string,
): JsonSchema | undefined {
    const schema = operation.outputSchema;
    const member = Object.hasOwn(schema.properties, name) ? schema.properties[name] : undefined;
    if (member === undefined || !schema.required?.includes(name)) {
        return undefined;
    }
    return toJsonSchema(member);
}
