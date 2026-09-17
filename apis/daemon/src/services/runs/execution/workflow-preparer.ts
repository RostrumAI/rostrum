import {
    createWorkflowValidator,
    escapePointerToken,
    type Finding,
    isReferenceObject,
    parseWorkflow,
    STEP_OUTPUT_REF_PATTERN,
    type WorkflowDocument,
    type WorkflowStep,
    type WorkflowValidator,
} from "@rostrum/workflow";
import type {
    ExecutionFailure,
    ExecutionFailureCode,
    JsonObject,
    JsonValue,
    PublicationBinding,
    RunInvocationRejectionReason,
} from "@rostrum/workflow/execution";
import { checkJsonValue, copyJsonValue, freezeJsonValue, MAX_VALUE_DEPTH } from "./json-value";
import {
    findTaskOperation,
    TASK_OPERATIONS,
    type TaskOperation,
    type TaskOperationConfig,
} from "./operation-contracts";
import { type CompiledValueCheck, ValueSchemaCompiler } from "./value-schema";

/**
 * Prepares one publication so a run can execute it.
 *
 * Preparation reads the publication's document, compiles the value schemas it
 * declares, and checks that this release can execute every declared step. It
 * produces an immutable prepared graph plus the invocation inputs, or it
 * refuses the invocation with a reason and the failures behind it. It never
 * executes work, allocates a run, or emits a work item.
 *
 * The prepared graph is read-only and may be shared: each invocation keeps its
 * own mutable run state beside it. Preparation compiles the operation
 * contracts once per process, so a step's checks are the same immutable
 * objects in every prepared publication.
 *
 * Publication validity is not execution support. A document that publishes
 * successfully can still declare an operation, a control-flow construct, or a
 * value schema this release cannot execute; preparation rejects that
 * publication without changing which documents are publishable.
 */

/** The publication content one invocation selects. */
export interface PublicationContent {
    /**
     * The verified publication binding.
     *
     * The caller reads the publication named by the invocation and must have
     * verified its integrity before preparing it; the binding is carried into
     * the prepared graph so an accepted run never depends on the publication
     * row again.
     */
    readonly binding: PublicationBinding;
    /** The stored canonical document text. */
    readonly canonicalText: string;
}

/** A resolved input binding of one step. */
export type PreparedBinding =
    | {
          /** The binding is a value the document carries. */
          readonly source: "literal";
          /** The immutable literal value. */
          readonly value: JsonValue;
      }
    | {
          /** The binding names a workflow input. */
          readonly source: "workflow_input";
          /** The declared input name, used as a flat key. */
          readonly name: string;
      }
    | {
          /** The binding names an output of an earlier step. */
          readonly source: "step_output";
          /** The step that produces the output. */
          readonly stepId: string;
          /** The declared output name, used as a flat key. */
          readonly outputName: string;
      };

/** The members every prepared step carries. */
interface PreparedStepBase {
    /** The step's identifier within the document. */
    readonly stepId: string;
    /** The step's position in the document's declared step order. */
    readonly index: number;
    /** The step's input bindings, keyed by input name. */
    readonly inputs: ReadonlyMap<string, PreparedBinding>;
    /** The author-declared output schemas, compiled, keyed by output name. */
    readonly declaredOutputs: ReadonlyMap<string, CompiledValueCheck>;
    /** Steps that must succeed before this step can start. */
    readonly dependencies: readonly string[];
}

/** One task step, ready to dispatch. */
export interface PreparedTaskStep extends PreparedStepBase {
    /** Marks the step as a unit of task work. */
    readonly kind: "task";
    /** The validated task configuration. */
    readonly config: TaskOperationConfig;
    /** The operation's compiled configuration, input, and output contracts. */
    readonly operation: CompiledTaskOperation;
    /** The successors that follow this step; at most one in M2. */
    readonly successors: readonly string[];
}

/** The terminal step, which the daemon completes itself. */
export interface PreparedResultStep extends PreparedStepBase {
    /** Marks the step as the workflow's terminal result. */
    readonly kind: "result";
}

/** One prepared step. */
export type PreparedStep = PreparedTaskStep | PreparedResultStep;

/** One supported operation with its contracts compiled once. */
export interface CompiledTaskOperation {
    /** The operation name. */
    readonly name: TaskOperation["name"];
    /** The check that validates one step's configuration. */
    readonly configCheck: CompiledValueCheck;
    /** The check that validates the fully resolved inputs of one execution. */
    readonly inputCheck: CompiledValueCheck;
    /** The check that validates the whole output of one execution. */
    readonly outputCheck: CompiledValueCheck;
}

/**
 * The immutable, runnable form of one publication.
 *
 * The same prepared graph serves every invocation of a publication. Progress,
 * outputs, and failures belong to the run, never to this value.
 */
export interface PreparedWorkflow {
    /** The publication this graph was prepared from. */
    readonly binding: PublicationBinding;
    /** The step where execution begins. */
    readonly entryStepId: string;
    /** Every declared step, including steps the run never reaches. */
    readonly steps: ReadonlyMap<string, PreparedStep>;
    /** The declared workflow input schemas, compiled, keyed by input name. */
    readonly inputChecks: ReadonlyMap<string, CompiledValueCheck>;
}

/** The outcome of preparing one invocation. */
export type WorkflowPreparationResult =
    | {
          /** The publication is executable and the inputs are accepted. */
          readonly ok: true;
          /** The prepared graph, shareable across runs. */
          readonly prepared: PreparedWorkflow;
          /** The validated inputs this run owns, deep-frozen. */
          readonly inputs: JsonObject;
      }
    | {
          /** The invocation was refused; no run may be created. */
          readonly ok: false;
          /** The distinct reason the caller acts on. */
          readonly reason: RunInvocationRejectionReason;
          /** The failures behind the reason, bounded and sanitized. */
          readonly failures: readonly ExecutionFailure[];
      };

/**
 * The most findings one refusal reports.
 *
 * Each failure is bounded and sanitized, and the cap keeps a corrupt or
 * enormous document from making one refused invocation retain an unbounded
 * diagnostic list. When findings are dropped, the last failure says how many.
 */
const MAX_REJECTION_FAILURES = 32;

/**
 * Refuses an invocation because this release cannot execute the publication.
 *
 * Reason and code stay separate: the reason tells a caller what to do, while
 * the failure code says which capability was missing.
 */
class PreparationRejection extends Error {
    readonly code: ExecutionFailureCode;
    readonly path: string;

    /** Records one refusal reason that becomes a failure entry. */
    constructor(code: ExecutionFailureCode, path: string, message: string) {
        super(message);
        this.code = code;
        this.path = path;
    }
}

/** Prepares publications for execution. */
export class WorkflowPreparer {
    private readonly maxValueDepth: number;
    private readonly schemaCompiler: ValueSchemaCompiler;
    private readonly compiledOperations: Readonly<Record<string, CompiledTaskOperation>>;
    private readonly validator: WorkflowValidator;

    /**
     * Creates a preparer for publications up to `maxValueDepth` container levels.
     *
     * Compiling the operation contracts is part of construction: the
     * operations are part of this release, so a contract that cannot compile
     * is a startup failure rather than a run-time rejection.
     */
    constructor(maxValueDepth: number = MAX_VALUE_DEPTH) {
        this.maxValueDepth = maxValueDepth;
        this.schemaCompiler = new ValueSchemaCompiler(maxValueDepth);
        this.compiledOperations = this.compileOperations();
        this.validator = createWorkflowValidator();
    }

    /**
     * Prepares one publication for the invocation that selected it.
     *
     * `inputs` is absent when the caller supplied none, which means the same
     * as an empty object. A successful result carries the inputs the run
     * owns: copied and frozen, because the caller keeps no reference into an
     * accepted run.
     */
    prepare(publication: PublicationContent, inputs?: JsonObject): WorkflowPreparationResult {
        // The stored bytes were verified against their digest before they
        // arrived here, so a document that does not parse or does not
        // validate is corrupt storage rather than author input.
        const parsed = parseWorkflow(publication.canonicalText);
        if (!parsed.ok) {
            return this.refuse("corrupt_publication", parsed.findings);
        }
        const validation = this.validator.validateDocument(parsed.document);
        if (!validation.validForPublication) {
            return this.refuse("corrupt_publication", validation.findings);
        }
        // Validation ran the document-shape stage, which is the one place a
        // document from storage becomes a typed document.
        const document = parsed.document as WorkflowDocument;

        // A publication this release cannot execute refuses the invocation as
        // a whole; input problems are reported separately, because corrected
        // values can be supplied again while an unsupported step cannot.
        const documentRefusals: PreparationRejection[] = [];
        const steps = this.prepareSteps(document, documentRefusals);
        const inputChecks = this.compileWorkflowInputs(document, documentRefusals);
        const inputRefusals: PreparationRejection[] = [];
        const acceptedInputs = this.validateInputs(inputChecks, inputs ?? {}, inputRefusals);
        if (documentRefusals.length > 0) {
            return this.refuse("unsupported_execution", documentRefusals);
        }
        if (inputRefusals.length > 0) {
            return this.refuse("invalid_inputs", inputRefusals);
        }

        return {
            ok: true,
            prepared: {
                binding: publication.binding,
                entryStepId: document.firstNode,
                steps,
                inputChecks,
            },
            inputs: acceptedInputs,
        };
    }

    /**
     * Prepares every declared step.
     *
     * Steps the run cannot reach stay in the graph and remain pending for the
     * whole run, inspectable rather than dropped. A step this release cannot
     * execute is recorded as a refusal, so the caller learns about every
     * unsupported construct at once.
     */
    private prepareSteps(
        document: WorkflowDocument,
        refusals: PreparationRejection[],
    ): ReadonlyMap<string, PreparedStep> {
        const steps = new Map<string, PreparedStep>();
        for (const [index, step] of document.steps.entries()) {
            const prepared = this.prepareStep(step, index, refusals);
            if (prepared) {
                steps.set(step.id, prepared);
            }
        }
        return steps;
    }

    /**
     * Prepares one step, recording every reason it cannot execute.
     *
     * A step is missing from the result only when this release cannot
     * represent it at all, which is always accompanied by a refusal: an
     * invocation that reaches execution has every declared step prepared.
     */
    private prepareStep(
        step: WorkflowStep,
        index: number,
        refusals: PreparationRejection[],
    ): PreparedStep | undefined {
        const stepPath = `/steps/${index}`;
        const base = {
            stepId: step.id,
            index,
            inputs: this.prepareBindings(step, index, refusals),
            declaredOutputs: this.compileDeclaredOutputs(step, index, refusals),
            dependencies: dedupe(step.dependencies ?? []),
        };
        if (step.loop) {
            refusals.push(
                new PreparationRejection(
                    "unsupported_control_flow",
                    `${stepPath}/loop`,
                    "Bounded loops are not supported yet",
                ),
            );
        }
        if (step.conditional) {
            refusals.push(
                new PreparationRejection(
                    "unsupported_control_flow",
                    `${stepPath}/conditional`,
                    "Conditional routing is not supported yet",
                ),
            );
        }

        if (step.type === "result") {
            this.checkResultStep(step, stepPath, refusals);
            return { ...base, kind: "result" };
        }
        if (step.type !== "task") {
            refusals.push(
                new PreparationRejection(
                    "unsupported_step_type",
                    `${stepPath}/type`,
                    `Step type '${step.type}' is not executable`,
                ),
            );
            return undefined;
        }
        return this.prepareTaskStep(step, stepPath, base, refusals);
    }

    /**
     * Prepares a task step, resolving its operation contract.
     *
     * A step whose successors or configuration this release does not support
     * still produces a prepared step, because one publication can hold
     * several problems and the caller should see all of them. The refusal list
     * decides whether anything runs at all.
     */
    private prepareTaskStep(
        step: WorkflowStep,
        stepPath: string,
        base: PreparedStepBase,
        refusals: PreparationRejection[],
    ): PreparedStep | undefined {
        const successors = dedupe(step.successors ?? []);
        if (successors.length > 1) {
            refusals.push(
                new PreparationRejection(
                    "unsupported_control_flow",
                    `${stepPath}/successors`,
                    "A step may reach only one successor in this release",
                ),
            );
        }

        const operation = this.resolveOperation(step, stepPath, refusals);
        if (!operation) {
            return undefined;
        }
        return {
            ...base,
            kind: "task",
            config: { operation: operation.name },
            operation,
            successors,
        };
    }

    /**
     * Resolves and validates the operation a task step declares.
     *
     * The step's `config` is exactly the operation declaration: an unknown
     * operation and an unknown configuration member are both refusals.
     */
    private resolveOperation(
        step: WorkflowStep,
        stepPath: string,
        refusals: PreparationRejection[],
    ): CompiledTaskOperation | undefined {
        const config = step.config ?? {};
        const name = "operation" in config ? config.operation : undefined;
        if (typeof name !== "string") {
            refusals.push(
                new PreparationRejection(
                    "unsupported_step_config",
                    `${stepPath}/config/operation`,
                    "A task step must declare an operation name",
                ),
            );
            return undefined;
        }
        const operation = findTaskOperation(name);
        const compiled = operation ? this.compiledOperations[operation.name] : undefined;
        if (!operation || !compiled) {
            refusals.push(
                new PreparationRejection(
                    "unsupported_step_config",
                    `${stepPath}/config/operation`,
                    `Operation '${name}' is not executable`,
                ),
            );
            return undefined;
        }
        const configCheck = compiled.configCheck.validate(config);
        if (!configCheck.ok) {
            refusals.push(
                new PreparationRejection(
                    "unsupported_step_config",
                    `${stepPath}/config${configCheck.path}`,
                    "Task configuration is not supported",
                ),
            );
        }
        return compiled;
    }

    /** Rejects a terminal step that declares successors or a non-empty config. */
    private checkResultStep(
        step: WorkflowStep,
        stepPath: string,
        refusals: PreparationRejection[],
    ): void {
        if ((step.successors ?? []).length > 0) {
            refusals.push(
                new PreparationRejection(
                    "unsupported_control_flow",
                    `${stepPath}/successors`,
                    "The result step ends the run and cannot have successors",
                ),
            );
        }
        if (Object.keys(step.config ?? {}).length > 0) {
            refusals.push(
                new PreparationRejection(
                    "unsupported_step_config",
                    `${stepPath}/config`,
                    "The result step takes no configuration",
                ),
            );
        }
    }

    /** Compiles the output schemas a step declares. */
    private compileDeclaredOutputs(
        step: WorkflowStep,
        index: number,
        refusals: PreparationRejection[],
    ): ReadonlyMap<string, CompiledValueCheck> {
        const outputs = new Map<string, CompiledValueCheck>();
        for (const [name, schema] of Object.entries(step.outputs ?? {})) {
            const compiled = this.schemaCompiler.compile(schema);
            const path = `/steps/${index}/outputs/${escapePointerToken(name)}`;
            if (!compiled.ok) {
                refusals.push(
                    new PreparationRejection(
                        compiled.code,
                        `${path}${compiled.path}`,
                        "Declared output schema cannot be prepared",
                    ),
                );
                continue;
            }
            outputs.set(name, compiled.check);
        }
        return outputs;
    }

    /** Compiles the schemas that describe the workflow's declared inputs. */
    private compileWorkflowInputs(
        document: WorkflowDocument,
        refusals: PreparationRejection[],
    ): ReadonlyMap<string, CompiledValueCheck> {
        const inputs = new Map<string, CompiledValueCheck>();
        for (const [name, schema] of Object.entries(document.inputs ?? {})) {
            const compiled = this.schemaCompiler.compile(schema);
            if (!compiled.ok) {
                refusals.push(
                    new PreparationRejection(
                        compiled.code,
                        `/inputs/${escapePointerToken(name)}${compiled.path}`,
                        "Declared input schema cannot be prepared",
                    ),
                );
                continue;
            }
            inputs.set(name, compiled.check);
        }
        return inputs;
    }

    /**
     * Resolves a step's input bindings.
     *
     * Only a whole reference binding is a reference: a nested `{ "ref": ... }`
     * inside a larger object is data, and a name containing dots is one flat
     * key rather than an object path.
     */
    private prepareBindings(
        step: WorkflowStep,
        index: number,
        refusals: PreparationRejection[],
    ): ReadonlyMap<string, PreparedBinding> {
        const bindings = new Map<string, PreparedBinding>();
        for (const [name, value] of Object.entries(step.inputs ?? {})) {
            const path = `/steps/${index}/inputs/${escapePointerToken(name)}`;
            bindings.set(name, this.prepareBinding(value, path, refusals));
        }
        return bindings;
    }

    /** Resolves one binding to its literal or reference source. */
    private prepareBinding(
        value: JsonValue,
        path: string,
        refusals: PreparationRejection[],
    ): PreparedBinding {
        if (!isReferenceObject(value)) {
            const checked = checkJsonValue(value, this.maxValueDepth);
            if (!checked.ok) {
                refusals.push(
                    new PreparationRejection(
                        checked.code === "value_depth" ? "value_depth" : "invalid_document",
                        `${path}${checked.path}`,
                        "Binding value exceeds the supported depth",
                    ),
                );
                return { source: "literal", value: null };
            }
            // A literal is shared by every run of this prepared graph, so it
            // is frozen: no handler can mutate a value another run will read.
            return { source: "literal", value: freezeJsonValue(checked.value) };
        }

        if (value.ref.startsWith("inputs.")) {
            return { source: "workflow_input", name: value.ref.slice("inputs.".length) };
        }
        const stepOutput = STEP_OUTPUT_REF_PATTERN.exec(value.ref);
        if (stepOutput?.[1] && stepOutput[2]) {
            return { source: "step_output", stepId: stepOutput[1], outputName: stepOutput[2] };
        }
        refusals.push(
            new PreparationRejection(
                "unsupported_binding",
                path,
                "Binding refers to a value this release cannot resolve",
            ),
        );
        return { source: "literal", value: null };
    }

    /**
     * Validates the invocation inputs against the workflow's declared inputs.
     *
     * Every declared input is required and no undeclared input is accepted.
     * Absence and `null` differ: an absent input is missing, while a `null`
     * value is validated against the declared schema like any other value.
     */
    private validateInputs(
        inputChecks: ReadonlyMap<string, CompiledValueCheck>,
        provided: JsonObject,
        refusals: PreparationRejection[],
    ): JsonObject {
        const accepted: Record<string, JsonValue> = {};
        for (const name of inputChecks.keys()) {
            if (!Object.hasOwn(provided, name)) {
                refusals.push(
                    new PreparationRejection(
                        "missing_input",
                        `/${escapePointerToken(name)}`,
                        `Workflow input '${name}' is required`,
                    ),
                );
            }
        }
        for (const [name, value] of Object.entries(provided)) {
            const check = inputChecks.get(name);
            if (!check) {
                refusals.push(
                    new PreparationRejection(
                        "undeclared_input",
                        `/${escapePointerToken(name)}`,
                        `Workflow input '${name}' is not declared`,
                    ),
                );
                continue;
            }
            const checked = check.validate(value);
            if (!checked.ok) {
                refusals.push(
                    new PreparationRejection(
                        checked.code === "value_depth" ? "value_depth" : "invalid_input",
                        `/${escapePointerToken(name)}${checked.path}`,
                        `Workflow input '${name}' does not satisfy its declared schema`,
                    ),
                );
                continue;
            }
            accepted[name] = copyJsonValue(value);
        }
        return Object.freeze(accepted);
    }

    /** Builds the refusal result for one rejected invocation. */
    private refuse(
        reason: RunInvocationRejectionReason,
        failures: readonly (PreparationRejection | Finding)[],
    ): WorkflowPreparationResult {
        const mapped = failures.map((failure) => this.toExecutionFailure(failure));
        if (mapped.length <= MAX_REJECTION_FAILURES) {
            return { ok: false, reason, failures: mapped };
        }
        const reported = mapped.slice(0, MAX_REJECTION_FAILURES);
        reported.push({
            code: "invalid_document",
            path: "",
            message: `${mapped.length - MAX_REJECTION_FAILURES} further failures omitted`,
        });
        return { ok: false, reason, failures: reported };
    }

    /**
     * Renders one refusal or validation finding as a bounded failure.
     *
     * A validation finding's message can describe document content, so only
     * its stable code and location are carried here.
     */
    private toExecutionFailure(failure: PreparationRejection | Finding): ExecutionFailure {
        if (failure instanceof PreparationRejection) {
            return {
                code: failure.code,
                path: failure.path,
                message: failure.message.slice(0, 512),
            };
        }
        return {
            code: "invalid_document",
            path: failure.path,
            message: `Stored publication content failed validation: ${failure.code}`,
        };
    }

    /** Compiles every supported operation's contracts once. */
    private compileOperations(): Readonly<Record<string, CompiledTaskOperation>> {
        const compiled: Record<string, CompiledTaskOperation> = {};
        for (const operation of TASK_OPERATIONS) {
            const configCheck = this.schemaCompiler.compile(operation.configSchema);
            const inputCheck = this.schemaCompiler.compile(operation.inputSchema);
            const outputCheck = this.schemaCompiler.compile(operation.outputSchema);
            if (!configCheck.ok || !inputCheck.ok || !outputCheck.ok) {
                throw new Error(`Operation '${operation.name}' declares an unusable schema`);
            }
            compiled[operation.name] = {
                name: operation.name,
                configCheck: configCheck.check,
                inputCheck: inputCheck.check,
                outputCheck: outputCheck.check,
            };
        }
        return Object.freeze(compiled);
    }
}

/** Removes repeated step identifiers, keeping the order they were declared in. */
function dedupe(stepIds: readonly string[]): readonly string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const stepId of stepIds) {
        if (seen.has(stepId)) {
            continue;
        }
        seen.add(stepId);
        unique.push(stepId);
    }
    return unique;
}
