/** @fileoverview Decides whether this daemon release can run a publication, and prepares it. */

import {
    catalogSchema,
    checkStaticCompatibility,
    createDeclaredSchemaCompiler,
    type DeclaredSchemaCompiler,
    escapePointerToken,
    isJsonSchema,
    isReferenceObject,
    type OperationCatalog,
    STATIC_ISSUE_CODES,
    STEP_OUTPUT_REF_PATTERN,
    type WorkflowDocument,
    WorkflowDocumentSchema,
    type WorkflowStep,
} from "@rostrum/workflow";
import type {
    ExecutionFailure,
    FailureCode,
    RunPublication,
    RunRefusal,
} from "@rostrum/workflow/execution";
import { Compile } from "typebox/compile";
import type {
    PreparedBinding,
    PreparedInput,
    PreparedStep,
    PreparedWorkflow,
    PreparedWorkflowInput,
} from "./prepared-workflow";
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

/** A run's accepted workflow inputs by name: one owned, deep-frozen copy. */
export type RunInputs = ReadonlyMap<string, unknown>;

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

/** The only workflow format this release executes. */
const SUPPORTED_FORMAT = "v1";

/** Checks parsed JSON against the workflow document's shape. */
const DOCUMENT_SHAPE = Compile(WorkflowDocumentSchema);

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
                failure("invalid_document", "", "The stored publication isn't valid JSON"),
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
                failure(
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
                    failure(
                        "undeclared_input",
                        inputPath(name),
                        `The workflow declares no input '${name}'`,
                    ),
                );
            }
        }

        // Every declared input is supplied and valid, or falls back to its default.
        for (const [name, declaration] of prepared.inputs) {
            const path = inputPath(name);
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
                    failure("missing_input", path, `The required input '${name}' is missing`),
                );
            }
        }

        if (failures.length > 0) {
            return {
                ok: false,
                refusal: { reason: "invalid_inputs", failures: sortFailures(failures) },
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

        const operationName = configOf(step).operation;
        const operation =
            typeof operationName === "string" ? this.catalog.get(operationName) : undefined;
        if (step.type !== "task" || !operation) {
            return undefined;
        }

        // Bound arguments keep their bindings; unbound optional ones get their default.
        const bindings = step.inputs ?? {};
        const inputs = new Map<string, PreparedInput>();
        for (const [name, argument] of Object.entries(operation.arguments)) {
            const check = this.checkerFor(catalogSchema(argument.schema));
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
            config: ownedCopy(configOf(step)),
            outputCheck: this.checkerFor(catalogSchema(operation.outputSchema)),
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
            failure(
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
                failure(
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

/**
 * Checks the parsed publication against the v1 document shape. An
 * unsupported format is reported on its own, since the rest of the shape
 * belongs to that format.
 */
function checkShape(parsed: unknown): ExecutionFailure[] {
    const format =
        typeof parsed === "object" && parsed !== null && "workflowFormatVersion" in parsed
            ? parsed.workflowFormatVersion
            : undefined;
    if (format !== undefined && format !== SUPPORTED_FORMAT) {
        return [
            failure(
                "unsupported_format",
                "/workflowFormatVersion",
                `This release executes format '${SUPPORTED_FORMAT}' only`,
            ),
        ];
    }
    if (DOCUMENT_SHAPE.Check(parsed)) {
        return [];
    }
    return [...DOCUMENT_SHAPE.Errors(parsed)].map((error) =>
        failure(
            "invalid_document",
            error.instancePath,
            `The document's shape is invalid: ${error.message}`,
        ),
    );
}

/** Checks that the document is the publication the run recorded. */
function checkIdentity(
    document: WorkflowDocument,
    publication: RunPublication,
): ExecutionFailure[] {
    const failures: ExecutionFailure[] = [];
    if (document.id !== publication.workflowId) {
        failures.push(
            failure("publication_mismatch", "/id", "The document isn't the requested workflow"),
        );
    }
    if (document.workflowFormatVersion !== publication.workflowFormatVersion) {
        failures.push(
            failure(
                "publication_mismatch",
                "/workflowFormatVersion",
                "The document's format doesn't match its publication",
            ),
        );
    }
    return failures;
}

/**
 * Checks the step identities and links the engine traverses: unique step
 * IDs, an existing entry step, and successors and dependencies that name
 * existing steps. Publication validation guarantees these, but the engine
 * can't run a document that breaks them.
 */
function checkStructure(document: WorkflowDocument): ExecutionFailure[] {
    const failures: ExecutionFailure[] = [];
    const ids = new Set<string>();
    for (const [index, step] of document.steps.entries()) {
        if (ids.has(step.id)) {
            failures.push(
                failure("invalid_document", `/steps/${index}/id`, "The step ID is a duplicate"),
            );
        }
        ids.add(step.id);
    }
    if (!ids.has(document.firstNode)) {
        failures.push(failure("invalid_document", "/firstNode", "The entry step doesn't exist"));
    }
    for (const [index, step] of document.steps.entries()) {
        for (const field of ["successors", "dependencies"] as const) {
            for (const [position, target] of (step[field] ?? []).entries()) {
                if (!ids.has(target)) {
                    failures.push(
                        failure(
                            "invalid_document",
                            `/steps/${index}/${field}/${position}`,
                            "The linked step doesn't exist",
                            step.id,
                        ),
                    );
                }
            }
        }
    }
    return failures;
}

/**
 * Checks the step types and control flow this release executes: task and
 * result steps, a result step without configuration, no conditionals or
 * loops, at most one distinct successor, and no step that depends on
 * itself.
 */
function checkSupportedSteps(document: WorkflowDocument): ExecutionFailure[] {
    const failures: ExecutionFailure[] = [];
    if ((document.conditionals ?? []).length > 0) {
        failures.push(
            failure(
                "unsupported_control_flow",
                "/conditionals",
                "Conditionals aren't executed by this release",
            ),
        );
    }
    for (const [index, step] of document.steps.entries()) {
        const path = `/steps/${index}`;
        if (step.type !== "task" && step.type !== "result") {
            failures.push(
                failure(
                    "unsupported_step_type",
                    `${path}/type`,
                    `Step type '${step.type}' isn't supported`,
                    step.id,
                ),
            );
        }
        if (step.type === "result" && step.config !== undefined) {
            failures.push(
                failure(
                    "invalid_config",
                    `${path}/config`,
                    "A result step has no configuration",
                    step.id,
                ),
            );
        }
        if (step.conditional !== undefined) {
            failures.push(
                failure(
                    "unsupported_control_flow",
                    `${path}/conditional`,
                    "Conditional routing isn't executed yet",
                    step.id,
                ),
            );
        }
        if (step.loop !== undefined) {
            failures.push(
                failure(
                    "unsupported_control_flow",
                    `${path}/loop`,
                    "Loops aren't executed yet",
                    step.id,
                ),
            );
        }
        if (new Set(step.successors ?? []).size > 1) {
            failures.push(
                failure(
                    "unsupported_control_flow",
                    `${path}/successors`,
                    "Parallel successors aren't executed yet",
                    step.id,
                ),
            );
        }
        for (const [position, dependency] of (step.dependencies ?? []).entries()) {
            if (dependency === step.id) {
                failures.push(
                    failure(
                        "self_dependency",
                        `${path}/dependencies/${position}`,
                        "The step lists itself as a dependency",
                        step.id,
                    ),
                );
            }
        }
    }
    return failures;
}

/** The task's configuration as named members; the document shape proved it's a JSON object. */
function configOf(step: WorkflowStep): Readonly<Record<string, unknown>> {
    return (step.config ?? {}) as Readonly<Record<string, unknown>>;
}

/** The JSON Pointer to one invocation input. */
function inputPath(name: string): string {
    return `/inputs/${escapePointerToken(name)}`;
}

/** Builds one located failure. */
function failure(
    code: FailureCode,
    path: string,
    message: string,
    stepId?: string,
): ExecutionFailure {
    const built: ExecutionFailure = { code, message, path };
    if (stepId !== undefined) {
        built.stepId = stepId;
    }
    return built;
}

/** Builds a refusal with its failures in pointer-then-code order. */
function refuse(reason: RunRefusal["reason"], failures: ExecutionFailure[]): Preparation {
    return { ok: false, refusal: { reason, failures: sortFailures(failures) } };
}

/** Orders failures by pointer, then code, so the same problems always read the same way. */
function sortFailures(failures: ExecutionFailure[]): ExecutionFailure[] {
    return [...failures].sort((a, b) => {
        if (a.path !== b.path) {
            return a.path < b.path ? -1 : 1;
        }
        if (a.code !== b.code) {
            return a.code < b.code ? -1 : 1;
        }
        return 0;
    });
}

/**
 * Takes an owned, deep-frozen copy of a JSON value, so nothing outside
 * the run can change it later. Author-chosen member names such as
 * `__proto__` stay ordinary own members.
 */
function ownedCopy<T>(value: T): T {
    return deepFreeze(structuredClone(value));
}

/** Freezes a JSON value and everything inside it. */
function deepFreeze<T>(value: T): T {
    if (typeof value === "object" && value !== null) {
        for (const member of Object.values(value)) {
            deepFreeze(member);
        }
        Object.freeze(value);
    }
    return value;
}
