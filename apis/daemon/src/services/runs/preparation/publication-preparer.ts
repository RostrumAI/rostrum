/** @fileoverview Decides whether this daemon release can run a publication, and prepares it. */

import {
    checkStaticCompatibility,
    createDeclaredSchemaCompiler,
    type DeclaredSchemaCompiler,
    escapePointerToken,
    getStepConfig,
    isJsonSchema,
    isReferenceObject,
    type OperationCatalog,
    STATIC_ISSUE_CODES,
    STEP_OUTPUT_REF_PATTERN,
    toJsonSchema,
    type WorkflowDocument,
    type WorkflowStep,
} from "@rostrum/workflow";
import type { ExecutionFailure, RunPublication, RunRefusal } from "@rostrum/workflow/execution";
import { ownedCopy } from "../owned-values";
import { createFailure, sortFailures } from "./execution-failures";
import type {
    PreparedBinding,
    PreparedInput,
    PreparedStep,
    PreparedWorkflow,
    PreparedWorkflowInput,
    RunInputs,
} from "./prepared-workflow";
import {
    checkIdentity,
    checkShape,
    checkStructure,
    checkSupportedSteps,
} from "./publication-checks";
import { createValueChecker, type ValueChecker } from "./value-checks";

/** The outcome of preparing a publication: an executable workflow, or a refusal listing every failure. */
export type Preparation =
    | {
          /** The publication can run on this release. */
          readonly ok: true;
          /** The prepared workflow. */
          readonly workflow: PreparedWorkflow;
      }
    | {
          /** The publication can't run on this release. */
          readonly ok: false;
          /** Why, with every located failure found. */
          readonly refusal: RunRefusal;
      };

/** The outcome of checking an invocation's inputs. */
export type InputValidation =
    | {
          /** The inputs match the declarations. */
          readonly ok: true;
          /** Every declared input, supplied or defaulted. */
          readonly inputs: RunInputs;
      }
    | {
          /** The inputs don't match the declarations. */
          readonly ok: false;
          /** The `invalid_inputs` refusal with every located failure found. */
          readonly refusal: RunRefusal;
      };

/**
 * Prepares publications for this daemon release.
 *
 * Preparation trusts the validation done at publication and doesn't run
 * the publication validator again. It answers a narrower question — can
 * this release execute this publication? — because the Control API and
 * the daemon can run different releases. It checks the document's shape
 * and identity, the step types and control flow this release supports,
 * self-dependency, and the shared static compatibility check against the
 * operations this daemon can run, then compiles the declared schemas and
 * prepares every binding.
 */
export class PublicationPreparer {
    private readonly catalog: OperationCatalog;

    /** Binds the preparer to the operations this daemon can run. */
    constructor(catalog: OperationCatalog) {
        this.catalog = catalog;
    }

    /**
     * Prepares a stored publication's canonical text for execution. Every
     * failure found is reported, not just the first. A document that can't
     * be read or doesn't match its publication is `corrupt_publication`;
     * anything this release can't run is `unsupported_execution`.
     */
    prepare(canonicalText: string, publication: RunPublication): Preparation {
        // The stored text passed its digest check, so a parse failure means corruption.
        let parsed: unknown;
        try {
            parsed = JSON.parse(canonicalText);
        } catch {
            return refuse("corrupt_publication", [
                createFailure("invalid_document", "", "The stored publication isn't valid JSON"),
            ]);
        }

        // Only a v1 document of the right shape can be read further.
        const shapeFailures = checkShape(parsed);
        if (shapeFailures.length > 0) {
            return refuse("unsupported_execution", shapeFailures);
        }
        // `checkShape` proved the value matches the document schema.
        const document = parsed as WorkflowDocument;

        // Collect every capability failure, then refuse or build.
        const compiler = createDeclaredSchemaCompiler();
        const failures = [
            ...checkIdentity(document, publication),
            ...checkStructure(document),
            ...checkSupportedSteps(document),
            ...checkStaticCompatibility(document, this.catalog, compiler).map((issue) =>
                createFailure(
                    STATIC_ISSUE_CODES[issue.kind].failureCode,
                    issue.path,
                    issue.message,
                    issue.stepId,
                ),
            ),
        ];
        const assembly = new PreparedWorkflowAssembly(document, this.catalog, compiler);
        const steps = assembly.prepareSteps(failures);
        if (failures.length > 0) {
            const corrupt = failures.some((found) => found.code === "publication_mismatch");
            return refuse(corrupt ? "corrupt_publication" : "unsupported_execution", failures);
        }

        return {
            ok: true,
            workflow: {
                publication,
                entryStepId: document.firstNode,
                steps,
                stepOrder: document.steps.map((step) => step.id),
                inputs: assembly.prepareInputs(),
            },
        };
    }

    /**
     * Checks one invocation's inputs against the prepared declarations:
     * no undeclared input, every required input supplied, and each value
     * valid against its schema without coercion. An omitted optional input
     * receives its default; an explicit `null` is a supplied value. Returns
     * one owned, deep-frozen copy of the inputs for the run.
     */
    validateInputs(
        prepared: PreparedWorkflow,
        supplied: Readonly<Record<string, unknown>>,
    ): InputValidation {
        const failures: ExecutionFailure[] = [];
        const inputs = new Map<string, unknown>();

        // Supplied names must be declared.
        for (const name of Object.keys(supplied)) {
            if (!prepared.inputs.has(name)) {
                failures.push(
                    createFailure(
                        "undeclared_input",
                        getInputPath(name),
                        `The workflow declares no input '${name}'`,
                    ),
                );
            }
        }

        // Every declared input is supplied and valid, or falls back to its default.
        for (const [name, declaration] of prepared.inputs) {
            const path = getInputPath(name);
            if (Object.hasOwn(supplied, name)) {
                const value = supplied[name];
                const invalid = declaration.check(value, { path, code: "invalid_input" });
                failures.push(...invalid);
                if (invalid.length === 0) {
                    inputs.set(name, ownedCopy(value));
                }
            } else if (declaration.default) {
                inputs.set(name, declaration.default.value);
            } else {
                failures.push(
                    createFailure("missing_input", path, `The required input '${name}' is missing`),
                );
            }
        }

        // A check that couldn't be evaluated says nothing about the caller's inputs.
        if (failures.length > 0) {
            const unchecked = failures.some((found) => found.code === "execution_error");
            return {
                ok: false,
                refusal: {
                    reason: unchecked ? "unsupported_execution" : "invalid_inputs",
                    failures: sortFailures(failures),
                },
            };
        }
        return { ok: true, inputs };
    }
}

/**
 * Builds the prepared steps and inputs of one document with one compiler,
 * recording a failure for anything it can't prepare.
 */
class PreparedWorkflowAssembly {
    private readonly document: WorkflowDocument;
    private readonly catalog: OperationCatalog;
    private readonly compiler: DeclaredSchemaCompiler;
    private readonly stepsById: ReadonlyMap<string, WorkflowStep>;

    /** Binds the assembly to one document, catalog, and compiler. */
    constructor(
        document: WorkflowDocument,
        catalog: OperationCatalog,
        compiler: DeclaredSchemaCompiler,
    ) {
        this.document = document;
        this.catalog = catalog;
        this.compiler = compiler;
        this.stepsById = new Map(document.steps.map((step) => [step.id, step]));
    }

    /** Prepares every step, appending a failure for each binding that can't be prepared. */
    prepareSteps(failures: ExecutionFailure[]): ReadonlyMap<string, PreparedStep> {
        const steps = new Map<string, PreparedStep>();
        for (const [index, step] of this.document.steps.entries()) {
            const prepared = this.prepareStep(step, index, failures);
            if (prepared) {
                steps.set(step.id, prepared);
            }
        }
        return steps;
    }

    /** Prepares the declared workflow inputs; call only when preparation found no failure. */
    prepareInputs(): ReadonlyMap<string, PreparedWorkflowInput> {
        const inputs = new Map<string, PreparedWorkflowInput>();
        for (const [name, declaration] of Object.entries(this.document.inputs ?? {})) {
            const prepared: PreparedWorkflowInput = { check: this.checkerFor(declaration.schema) };
            if (Object.hasOwn(declaration, "default")) {
                inputs.set(name, {
                    ...prepared,
                    default: { value: ownedCopy(declaration.default) },
                });
            } else {
                inputs.set(name, prepared);
            }
        }
        return inputs;
    }

    /**
     * Prepares one step of a supported type. Returns undefined for a step
     * the earlier checks already refused.
     */
    private prepareStep(
        step: WorkflowStep,
        index: number,
        failures: ExecutionFailure[],
    ): PreparedStep | undefined {
        const path = `/steps/${index}`;
        const base = {
            id: step.id,
            index,
            path,
            successors: [...new Set(step.successors ?? [])],
            dependencies: [...new Set(step.dependencies ?? [])],
        };

        if (step.type === "result") {
            const inputs = new Map<string, PreparedInput>();
            for (const [name, value] of Object.entries(step.inputs ?? {})) {
                const inputPointer = `${path}/inputs/${escapePointerToken(name)}`;
                const binding = this.prepareBinding(value, inputPointer, step.id, failures);
                if (binding) {
                    inputs.set(name, { binding, path: inputPointer });
                }
            }
            return { ...base, kind: "result", inputs };
        }

        const operationName = getStepConfig(step).operation;
        const operation =
            typeof operationName === "string" ? this.catalog.get(operationName) : undefined;
        if (step.type !== "task" || !operation) {
            return undefined;
        }

        // Bound arguments keep their bindings; unbound optional ones get their default.
        const bindings = step.inputs ?? {};
        const inputs = new Map<string, PreparedInput>();
        for (const [name, argument] of Object.entries(operation.arguments)) {
            const check = this.checkerFor(toJsonSchema(argument.schema));
            if (Object.hasOwn(bindings, name)) {
                const inputPointer = `${path}/inputs/${escapePointerToken(name)}`;
                const binding = this.prepareBinding(
                    bindings[name],
                    inputPointer,
                    step.id,
                    failures,
                );
                if (binding) {
                    inputs.set(name, { binding, path: inputPointer, check });
                }
            } else if (Object.hasOwn(argument, "default")) {
                const binding: PreparedBinding = {
                    kind: "literal",
                    value: ownedCopy(argument.default),
                };
                inputs.set(name, { binding, path: `${path}/inputs`, check });
            }
        }

        // Outputs are checked against the operation's schema and the step's own declarations.
        const declaredOutputs = new Map<string, ValueChecker>();
        for (const [name, schema] of Object.entries(step.outputs ?? {})) {
            if (isJsonSchema(schema)) {
                declaredOutputs.set(name, this.checkerFor(schema));
            }
        }
        return {
            ...base,
            kind: "task",
            inputs,
            operation,
            config: ownedCopy(getStepConfig(step)),
            outputCheck: this.checkerFor(toJsonSchema(operation.outputSchema)),
            declaredOutputs,
        };
    }

    /**
     * Turns one binding value into a literal owned by the prepared workflow
     * or a reference the engine resolves during the run. A reference that
     * doesn't name a declared input or a declared output of an existing
     * step is `unresolved_binding`.
     */
    private prepareBinding(
        value: unknown,
        path: string,
        stepId: string,
        failures: ExecutionFailure[],
    ): PreparedBinding | undefined {
        if (!isReferenceObject(value)) {
            return { kind: "literal", value: ownedCopy(value) };
        }
        const ref = value.ref;
        if (ref.startsWith("inputs.")) {
            const inputName = ref.slice("inputs.".length);
            if (Object.hasOwn(this.document.inputs ?? {}, inputName)) {
                return { kind: "workflow-input", inputName };
            }
        }
        const match = STEP_OUTPUT_REF_PATTERN.exec(ref);
        const producer = match?.[1] === undefined ? undefined : this.stepsById.get(match[1]);
        const outputName = match?.[2];
        if (
            producer &&
            outputName !== undefined &&
            Object.hasOwn(producer.outputs ?? {}, outputName)
        ) {
            return { kind: "step-output", stepId: producer.id, outputName };
        }
        failures.push(
            createFailure(
                "unresolved_binding",
                path,
                `The reference '${ref}' can't be resolved by this release`,
                stepId,
            ),
        );
        return undefined;
    }

    /**
     * Builds a value checker for a schema the static check already
     * compiled successfully; preparation only calls this when it found no
     * invalid schema.
     */
    private checkerFor(schema: unknown): ValueChecker {
        const compiled = isJsonSchema(schema) ? this.compiler.compile(schema) : undefined;
        if (!compiled?.ok) {
            // Invalid declarations were reported as `invalid_schema`, so no run can reach this checker.
            return (_value, location) => [
                createFailure(
                    "invalid_schema",
                    location.path,
                    "The declaration can't be checked",
                    location.stepId,
                ),
            ];
        }
        return createValueChecker(compiled.check);
    }
}

/** The JSON Pointer to one invocation input. */
function getInputPath(name: string): string {
    return `/inputs/${escapePointerToken(name)}`;
}

/** Builds a refusal with its failures in pointer-then-code order. */
function refuse(reason: RunRefusal["reason"], failures: ExecutionFailure[]): Preparation {
    return { ok: false, refusal: { reason, failures: sortFailures(failures) } };
}
