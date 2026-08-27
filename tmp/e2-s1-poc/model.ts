export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Binding = JsonValue | { ref: string };
export type ValueType = "string" | "number" | "boolean" | "object" | "array" | "null";

export interface Step {
    id: string;
    type: "task" | "result";
    operation?: string;
    inputs?: Record<string, Binding>;
    outputTypes?: Record<string, ValueType>;
    successors?: string[];
    dependencies?: string[];
    conditional?: string;
}

export type Condition =
    | { ref: string; op: "eq" | "neq" | "truthy" | "falsy"; value?: JsonValue }
    | { all: Condition[] }
    | { any: Condition[] };

export interface Conditional {
    id: string;
    branches: Array<{
        label: string;
        priority: number;
        condition: Condition;
        next?: string;
    }>;
    default: { label: string; next?: string };
}

export interface Workflow {
    firstNode: string;
    inputTypes: Record<string, ValueType>;
    steps: Step[];
    conditionals?: Conditional[];
}

export interface RunFailure {
    code: string;
    message: string;
    phase: "invocation" | "binding" | "handler" | "routing" | "output" | "loop" | "scheduler";
    stepId?: string;
    conditionalId?: string;
    path?: string;
    details: Record<string, JsonValue>;
}
export type HandlerOutcome =
    | { kind: "success"; outputs: Record<string, JsonValue> }
    | { kind: "failure"; failure: Omit<RunFailure, "stepId"> };

export interface Dispatch {
    stepId: string;
    operation: string;
    inputs: Record<string, JsonValue>;
}

export type RunStatus = "queued" | "running" | "stopping" | "succeeded" | "failed";
export type StepStatus =
    | "pending"
    | "ready"
    | "running"
    | "succeeded"
    | "failed"
    | "notSelected";

export interface TraceEvent {
    sequence: number;
    kind: "run" | "step" | "branch";
    state: string;
    stepId?: string;
    conditionalId?: string;
    branch?: string;
}

export interface ProofCounters {
    readinessChecks: number;
    dependencyEdgesVisited: number;
    successorEdgesVisited: number;
}

export type AcceptResult =
    | { accepted: true; run: ReferenceRun }
    | { accepted: false; failure: RunFailure };

interface Plan {
    steps: Map<string, Step>;
    conditionals: Map<string, Conditional>;
    dependencyConsumers: Map<string, string[]>;
}

function valueType(value: JsonValue): ValueType {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value as ValueType;
}

function failure(
    code: string,
    message: string,
    phase: RunFailure["phase"],
    details: Record<string, JsonValue>,
    extra: Partial<RunFailure> = {},
): RunFailure {
    return { code, message, phase, details, ...extra };
}

function isFailure(value: JsonValue | RunFailure): value is RunFailure {
    return typeof value === "object" && value !== null && !Array.isArray(value) && "code" in value;
}

function validateStructuredFanouts(
    workflow: Workflow,
    steps: Map<string, Step>,
    conditionals: Map<string, Conditional>,
): RunFailure | undefined {
    const adjacency = new Map<string, string[]>();
    for (const step of workflow.steps) {
        const targets = [...(step.successors ?? [])];
        if (step.conditional) {
            const conditional = conditionals.get(step.conditional);
            if (conditional) {
                for (const branch of conditional.branches) {
                    if (branch.next) targets.push(branch.next);
                }
                if (conditional.default.next) targets.push(conditional.default.next);
            }
        }
        adjacency.set(step.id, [...new Set(targets)]);
    }

    const distancesFrom = (start: string): Map<string, number> => {
        const distances = new Map([[start, 0]]);
        const queue = [start];
        for (let index = 0; index < queue.length; index += 1) {
            const node = queue[index];
            const distance = distances.get(node)!;
            for (const target of adjacency.get(node) ?? []) {
                if (distances.has(target)) continue;
                distances.set(target, distance + 1);
                queue.push(target);
            }
        }
        return distances;
    };

    for (const split of workflow.steps.filter((step) => (step.successors?.length ?? 0) > 1)) {
        const roots = split.successors!;
        for (const root of roots) {
            const rootStep = steps.get(root);
            if (rootStep?.conditional) {
                return failure(
                    "run.definition.fanout-conditional",
                    `Fan-out step '${split.id}' directly targets conditional step '${root}'.`,
                    "invocation",
                    { splitStepId: split.id, conditionalStepId: root },
                    { stepId: root },
                );
            }
            if ((adjacency.get(root)?.length ?? 0) === 0) {
                return failure(
                    "run.definition.fanout-terminal",
                    `Fan-out step '${split.id}' directly targets terminal step '${root}'.`,
                    "invocation",
                    { splitStepId: split.id, terminalStepId: root },
                    { stepId: root },
                );
            }
        }
        const distanceMaps = roots.map(distancesFrom);
        const common = [...distanceMaps[0].keys()].filter((candidate) =>
            distanceMaps.every((distances) => distances.has(candidate)),
        );
        if (common.length === 0) {
            return failure(
                "run.definition.fanout-without-join",
                `Fan-out step '${split.id}' has no common join.`,
                "invocation",
                { splitStepId: split.id },
                { stepId: split.id },
            );
        }

        const ranked = common
            .map((candidate) => {
                const distances = distanceMaps.map((items) => items.get(candidate)!);
                return {
                    candidate,
                    maximumDistance: Math.max(...distances),
                    totalDistance: distances.reduce((total, item) => total + item, 0),
                };
            })
            .sort(
                (left, right) =>
                    left.maximumDistance - right.maximumDistance ||
                    left.totalDistance - right.totalDistance ||
                    left.candidate.localeCompare(right.candidate),
            );
        const joinId = ranked[0].candidate;
        const equallyRanked = ranked.filter(
            (item) =>
                item.maximumDistance === ranked[0].maximumDistance &&
                item.totalDistance === ranked[0].totalDistance,
        );
        if (equallyRanked.length !== 1) {
            return failure(
                "run.definition.fanout-ambiguous-join",
                `Fan-out step '${split.id}' has no unique first join.`,
                "invocation",
                { splitStepId: split.id, candidates: equallyRanked.map((item) => item.candidate) },
                { stepId: split.id },
            );
        }
        if (steps.get(joinId)?.conditional) {
            return failure(
                "run.definition.fanout-conditional-join",
                `Fan-out step '${split.id}' joins directly into conditional step '${joinId}'.`,
                "invocation",
                { splitStepId: split.id, conditionalStepId: joinId },
                { stepId: joinId },
            );
        }

        const branchRegions: Array<Set<string>> = [];
        const branchExits: string[] = [];
        for (const root of roots) {
            const region = new Set<string>();
            const queue = [root];
            for (let index = 0; index < queue.length; index += 1) {
                const node = queue[index];
                if (node === joinId || region.has(node)) continue;
                region.add(node);
                for (const target of adjacency.get(node) ?? []) {
                    if (target !== joinId) queue.push(target);
                }
            }

            for (const priorRegion of branchRegions) {
                if ([...region].some((node) => priorRegion.has(node))) {
                    return failure(
                        "run.definition.fanout-crossed-branches",
                        `Fan-out step '${split.id}' has branches that merge before their join.`,
                        "invocation",
                        { splitStepId: split.id, joinStepId: joinId },
                        { stepId: split.id },
                    );
                }
            }

            for (const node of region) {
                const candidate = steps.get(node);
                if (candidate?.conditional) {
                    return failure(
                        "run.definition.fanout-conditional",
                        `Fan-out branch from '${split.id}' reaches conditional step '${node}' before joining.`,
                        "invocation",
                        { splitStepId: split.id, conditionalStepId: node, joinStepId: joinId },
                        { stepId: node },
                    );
                }
                if ((adjacency.get(node)?.length ?? 0) === 0) {
                    return failure(
                        "run.definition.fanout-terminal",
                        `Fan-out branch from '${split.id}' reaches terminal step '${node}' before joining.`,
                        "invocation",
                        { splitStepId: split.id, terminalStepId: node, joinStepId: joinId },
                        { stepId: node },
                    );
                }
                for (const target of adjacency.get(node) ?? []) {
                    if (target !== joinId && !region.has(target)) {
                        return failure(
                            "run.definition.fanout-leaked-branch",
                            `Fan-out branch from '${split.id}' leaves its structured region.`,
                            "invocation",
                            { splitStepId: split.id, sourceStepId: node, targetStepId: target },
                            { stepId: node },
                        );
                    }
                }
            }

            const exits = [...region].filter((node) => adjacency.get(node)?.includes(joinId));
            if (exits.length !== 1) {
                return failure(
                    "run.definition.fanout-branch-exit",
                    `Fan-out branch '${root}' must have exactly one edge to join '${joinId}'.`,
                    "invocation",
                    { splitStepId: split.id, branchRoot: root, joinStepId: joinId, exits },
                    { stepId: split.id },
                );
            }
            branchRegions.push(region);
            branchExits.push(exits[0]);
        }

        const joinDependencies = [...(steps.get(joinId)?.dependencies ?? [])].sort();
        const expectedDependencies = [...branchExits].sort();
        if (JSON.stringify(joinDependencies) !== JSON.stringify(expectedDependencies)) {
            return failure(
                "run.definition.fanout-join-dependencies",
                `Join step '${joinId}' dependencies do not match the fan-out branch exits.`,
                "invocation",
                { joinStepId: joinId, expectedDependencies, receivedDependencies: joinDependencies },
                { stepId: joinId },
            );
        }
    }
}

export interface HandlerContract {
    requiredInputs: Record<string, ValueType>;
    optionalInputs?: Record<string, ValueType>;
    outputs: Record<string, ValueType>;
}

export function validateHandlerContracts(
    workflow: Workflow,
    contracts: ReadonlyMap<string, HandlerContract>,
): RunFailure[] {
    const steps = new Map(workflow.steps.map((step) => [step.id, step]));
    const findings: RunFailure[] = [];
    const bindingType = (binding: Binding): ValueType | undefined => {
        if (
            typeof binding === "object" &&
            binding !== null &&
            !Array.isArray(binding) &&
            Object.keys(binding).length === 1 &&
            "ref" in binding &&
            typeof binding.ref === "string"
        ) {
            if (binding.ref.startsWith("inputs.")) {
                return workflow.inputTypes[binding.ref.slice("inputs.".length)];
            }
            if (binding.ref.startsWith("step.")) {
                const tail = binding.ref.slice("step.".length);
                const separator = tail.lastIndexOf(".");
                if (separator > 0) {
                    const producer = steps.get(tail.slice(0, separator));
                    return producer?.outputTypes?.[tail.slice(separator + 1)];
                }
            }
            return undefined;
        }
        return valueType(binding as JsonValue);
    };

    for (const step of workflow.steps) {
        if (step.type !== "task") continue;
        const contract = step.operation ? contracts.get(step.operation) : undefined;
        if (!contract) {
            findings.push(
                failure(
                    "run.definition.handler-contract-missing",
                    `Step '${step.id}' has no registered handler contract.`,
                    "invocation",
                    { operation: step.operation ?? null },
                    { stepId: step.id },
                ),
            );
            continue;
        }

        const allowedInputs = { ...contract.requiredInputs, ...(contract.optionalInputs ?? {}) };
        for (const [name, expectedType] of Object.entries(contract.requiredInputs)) {
            if (!(name in (step.inputs ?? {}))) {
                findings.push(
                    failure(
                        "run.definition.handler-input-missing",
                        `Step '${step.id}' is missing required handler input '${name}'.`,
                        "invocation",
                        { input: name, expectedType },
                        { stepId: step.id, path: `/steps/${step.id}/inputs/${name}` },
                    ),
                );
            }
        }
        for (const [name, binding] of Object.entries(step.inputs ?? {})) {
            const expectedType = allowedInputs[name];
            if (!expectedType) {
                findings.push(
                    failure(
                        "run.definition.handler-input-unknown",
                        `Step '${step.id}' binds unknown handler input '${name}'.`,
                        "invocation",
                        { input: name },
                        { stepId: step.id, path: `/steps/${step.id}/inputs/${name}` },
                    ),
                );
                continue;
            }
            const receivedType = bindingType(binding);
            if (receivedType !== expectedType) {
                findings.push(
                    failure(
                        "run.definition.handler-input-type",
                        `Step '${step.id}' binds the wrong type to handler input '${name}'.`,
                        "invocation",
                        { input: name, expectedType, receivedType: receivedType ?? null },
                        { stepId: step.id, path: `/steps/${step.id}/inputs/${name}` },
                    ),
                );
            }
        }

        const declaredOutputs = Object.entries(step.outputTypes ?? {}).sort(([left], [right]) =>
            left.localeCompare(right),
        );
        const contractOutputs = Object.entries(contract.outputs).sort(([left], [right]) =>
            left.localeCompare(right),
        );
        if (JSON.stringify(declaredOutputs) !== JSON.stringify(contractOutputs)) {
            findings.push(
                failure(
                    "run.definition.handler-output-contract",
                    `Step '${step.id}' output declaration does not exactly match its handler contract.`,
                    "invocation",
                    { declaredOutputs, contractOutputs },
                    { stepId: step.id, path: `/steps/${step.id}/outputs` },
                ),
            );
        }
    }

    return findings.sort((left, right) => {
        const leftKey = `${left.stepId ?? ""}:${left.code}:${left.path ?? ""}`;
        const rightKey = `${right.stepId ?? ""}:${right.code}:${right.path ?? ""}`;
        return leftKey.localeCompare(rightKey);
    });
}


function compile(workflow: Workflow): Plan | RunFailure {
    const steps = new Map(workflow.steps.map((step) => [step.id, step]));
    if (steps.size !== workflow.steps.length || !steps.has(workflow.firstNode)) {
        return failure(
            "run.definition.invalid-plan",
            "The published workflow cannot be compiled into an execution plan.",
            "invocation",
            { firstNode: workflow.firstNode },
        );
    }

    const conditionals = new Map((workflow.conditionals ?? []).map((item) => [item.id, item]));

    const fanoutFailure = validateStructuredFanouts(workflow, steps, conditionals);
    if (fanoutFailure) return fanoutFailure;
    for (const conditional of conditionals.values()) {
        const priorities = new Set<number>();
        if (
            conditional.branches.some((branch) => branch.next === undefined) ||
            conditional.default.next === undefined
        ) {
            return failure(
                "run.definition.conditional-terminal",
                `Conditional '${conditional.id}' must route every outcome to a step.`,
                "invocation",
                {},
                { conditionalId: conditional.id },
            );
        }
        for (const branch of conditional.branches) {
            if (priorities.has(branch.priority)) {
                return failure(
                    "run.definition.duplicate-branch-priority",
                    `Conditional '${conditional.id}' has duplicate branch priority '${branch.priority}'.`,
                    "invocation",
                    { priority: branch.priority },
                    { conditionalId: conditional.id },
                );
            }
            priorities.add(branch.priority);
        }
    }
    const dependencyConsumers = new Map<string, string[]>();
    for (const step of workflow.steps) {
        for (const dependency of step.dependencies ?? []) {
            const consumers = dependencyConsumers.get(dependency) ?? [];
            consumers.push(step.id);
            dependencyConsumers.set(dependency, consumers);
        }
    }

    return { steps, conditionals, dependencyConsumers };
}

export function accept(
    workflow: Workflow,
    inputs: Record<string, JsonValue>,
    supportedOperations: ReadonlySet<string>,
): AcceptResult {
    const plan = compile(workflow);
    if ("code" in plan) return { accepted: false, failure: plan };

    for (const [name, expectedType] of Object.entries(workflow.inputTypes)) {
        if (!(name in inputs)) {
            return {
                accepted: false,
                failure: failure(
                    "run.input.missing",
                    `Required workflow input '${name}' is missing.`,
                    "invocation",
                    { input: name, expectedType },
                    { path: `/inputs/${name}` },
                ),
            };
        }
        if (valueType(inputs[name]) !== expectedType) {
            return {
                accepted: false,
                failure: failure(
                    "run.input.type",
                    `Workflow input '${name}' has the wrong type.`,
                    "invocation",
                    { input: name, expectedType, receivedType: valueType(inputs[name]) },
                    { path: `/inputs/${name}` },
                ),
            };
        }
    }

    for (const name of Object.keys(inputs)) {
        if (!(name in workflow.inputTypes)) {
            return {
                accepted: false,
                failure: failure(
                    "run.input.unknown",
                    `Workflow input '${name}' is not declared.`,
                    "invocation",
                    { input: name },
                    { path: `/inputs/${name}` },
                ),
            };
        }
    }

    for (const step of workflow.steps) {
        if (step.type === "task" && (!step.operation || !supportedOperations.has(step.operation))) {
            return {
                accepted: false,
                failure: failure(
                    "run.step.unsupported",
                    `Step '${step.id}' has no registered handler.`,
                    "invocation",
                    { operation: step.operation ?? null },
                    { stepId: step.id },
                ),
            };
        }
    }

    return { accepted: true, run: new ReferenceRun(workflow, plan, inputs) };
}

export class ReferenceRun {
    readonly stepStates = new Map<string, StepStatus>();
    readonly stepOutputs = new Map<string, Record<string, JsonValue>>();
    readonly trace: TraceEvent[] = [];
    readonly counters: ProofCounters = {
        readinessChecks: 0,
        dependencyEdgesVisited: 0,
        successorEdgesVisited: 0,
    };

    status: RunStatus = "queued";
    output?: Record<string, JsonValue>;
    readonly terminalFailures: RunFailure[] = [];

    private readonly activated = new Set<string>();
    private readonly active = new Set<string>();
    private readonly ready = new Set<string>();
    private readonly observedFailures: RunFailure[] = [];
    private readonly remainingDependencies = new Map<string, number>();
    private sequence = 0;

    constructor(
        private readonly workflow: Workflow,
        private readonly plan: Plan,
        private readonly inputs: Record<string, JsonValue>,
    ) {
        for (const step of workflow.steps) {
            this.stepStates.set(step.id, "pending");
            this.remainingDependencies.set(step.id, step.dependencies?.length ?? 0);
        }
    }

    get currentSteps(): Array<{ stepId: string; state: "ready" | "running" }> {
        return [
            ...[...this.ready].map((stepId) => ({ stepId, state: "ready" as const })),
            ...[...this.active].map((stepId) => ({ stepId, state: "running" as const })),
        ].sort((left, right) => left.stepId.localeCompare(right.stepId));
    }

    start(): void {
        if (this.status !== "queued") throw new Error("Run already started");
        this.status = "running";
        this.record({ kind: "run", state: "running" });
        this.activate(this.workflow.firstNode);
        this.pumpVirtualResults();
        this.checkQuiescence();
    }

    dispatchReady(capacity = Number.POSITIVE_INFINITY): Dispatch[] {
        if (this.status !== "running") return [];
        this.pumpVirtualResults();
        if (this.status !== "running") return [];

        const available = Math.max(0, capacity - this.active.size);
        const dispatched: Dispatch[] = [];
        for (const stepId of [...this.ready].sort().slice(0, available)) {
            const step = this.plan.steps.get(stepId)!;
            if (step.type === "result") continue;
            const resolved = this.resolveBindings(step);
            if (isFailure(resolved)) {
                this.observeFailure({ ...resolved, stepId });
                break;
            }
            this.ready.delete(stepId);
            this.active.add(stepId);
            this.stepStates.set(stepId, "running");
            this.record({ kind: "step", state: "running", stepId });
            dispatched.push({ stepId, operation: step.operation!, inputs: resolved });
        }
        this.checkQuiescence();
        return dispatched;
    }

    complete(stepId: string, outcome: HandlerOutcome): void {
        if (!this.active.has(stepId)) throw new Error(`Step '${stepId}' is not running`);
        this.active.delete(stepId);

        if (outcome.kind === "failure") {
            this.stepStates.set(stepId, "failed");
            this.record({ kind: "step", state: "failed", stepId });
            this.observeFailure({ ...outcome.failure, stepId });
            this.checkQuiescence();
            return;
        }

        const step = this.plan.steps.get(stepId)!;
        const outputFailure = this.validateOutputs(step, outcome.outputs);
        if (outputFailure) {
            this.stepStates.set(stepId, "failed");
            this.record({ kind: "step", state: "failed", stepId });
            this.observeFailure({ ...outputFailure, stepId });
            this.checkQuiescence();
            return;
        }

        this.stepStates.set(stepId, "succeeded");
        this.stepOutputs.set(stepId, outcome.outputs);
        this.record({ kind: "step", state: "succeeded", stepId });

        for (const consumer of this.plan.dependencyConsumers.get(stepId) ?? []) {
            this.counters.dependencyEdgesVisited += 1;
            const remaining = this.remainingDependencies.get(consumer);
            if (remaining !== undefined && remaining > 0) {
                this.remainingDependencies.set(consumer, remaining - 1);
            }
            this.considerReady(consumer);
        }
        if (this.status === "running") this.route(step);
        this.pumpVirtualResults();
        this.checkQuiescence();
    }

    private route(step: Step): void {
        if (step.conditional) {
            const conditional = this.plan.conditionals.get(step.conditional);
            if (!conditional) {
                this.observeFailure(
                    failure(
                        "run.routing.unknown-conditional",
                        `Conditional '${step.conditional}' is unavailable.`,
                        "routing",
                        {},
                        { stepId: step.id, conditionalId: step.conditional },
                    ),
                );
                return;
            }
            const selected = this.selectBranch(conditional);
            if ("code" in selected) {
                this.observeFailure({ ...selected, stepId: step.id, conditionalId: conditional.id });
                return;
            }
            this.record({
                kind: "branch",
                state: "selected",
                stepId: step.id,
                conditionalId: conditional.id,
                branch: selected.label,
            });
            if (selected.next) this.activate(selected.next);
            else this.succeed(this.stepOutputs.get(step.id) ?? {});
            return;
        }

        for (const successor of [...(step.successors ?? [])].sort()) {
            this.counters.successorEdgesVisited += 1;
            this.activate(successor);
        }
    }

    private selectBranch(
        conditional: Conditional,
    ): { label: string; next?: string } | RunFailure {
        const ordered = conditional.branches
            .map((branch, index) => ({ branch, index }))
            .sort((left, right) =>
                left.branch.priority === right.branch.priority
                    ? left.index - right.index
                    : left.branch.priority - right.branch.priority,
            );
        for (const { branch } of ordered) {
            const matches = this.evaluateCondition(branch.condition);
            if (typeof matches !== "boolean") return matches;
            if (matches) return { label: branch.label, next: branch.next };
        }
        return conditional.default;
    }

    private evaluateCondition(condition: Condition): boolean | RunFailure {
        if ("all" in condition) {
            for (const child of condition.all) {
                const result = this.evaluateCondition(child);
                if (typeof result !== "boolean" || !result) return result;
            }
            return true;
        }
        if ("any" in condition) {
            for (const child of condition.any) {
                const result = this.evaluateCondition(child);
                if (typeof result !== "boolean") return result;
                if (result) return true;
            }
            return false;
        }

        const resolved = this.resolveReference(condition.ref);
        if (isFailure(resolved)) return resolved;
        switch (condition.op) {
            case "eq":
                return JSON.stringify(resolved) === JSON.stringify(condition.value);
            case "neq":
                return JSON.stringify(resolved) !== JSON.stringify(condition.value);
            case "truthy":
                return Boolean(resolved);
            case "falsy":
                return !resolved;
        }
    }

    private activate(stepId: string): void {
        if (this.status !== "running" || this.activated.has(stepId)) return;
        this.activated.add(stepId);
        this.considerReady(stepId);
    }

    private considerReady(stepId: string): void {
        this.counters.readinessChecks += 1;
        if (!this.activated.has(stepId) || this.stepStates.get(stepId) !== "pending") return;
        const step = this.plan.steps.get(stepId);
        if (!step) {
            this.observeFailure(
                failure(
                    "run.scheduler.unknown-step",
                    `Activated step '${stepId}' is unavailable.`,
                    "scheduler",
                    {},
                    { stepId },
                ),
            );
            return;
        }
        if ((this.remainingDependencies.get(stepId) ?? 0) !== 0) return;
        this.stepStates.set(stepId, "ready");
        this.ready.add(stepId);
        this.record({ kind: "step", state: "ready", stepId });
    }

    private resolveBindings(step: Step): Record<string, JsonValue> | RunFailure {
        const resolved: Record<string, JsonValue> = {};
        for (const [name, binding] of Object.entries(step.inputs ?? {})) {
            if (
                typeof binding === "object" &&
                binding !== null &&
                !Array.isArray(binding) &&
                Object.keys(binding).length === 1 &&
                "ref" in binding &&
                typeof binding.ref === "string"
            ) {
                const value = this.resolveReference(binding.ref);
                if (isFailure(value)) return { ...value, path: `/steps/${step.id}/inputs/${name}` };
                resolved[name] = value;
            } else {
                resolved[name] = binding as JsonValue;
            }
        }
        return resolved;
    }

    private resolveReference(reference: string): JsonValue | RunFailure {
        if (reference.startsWith("inputs.")) {
            const name = reference.slice("inputs.".length);
            if (name in this.inputs) return this.inputs[name];
        }
        if (reference.startsWith("step.")) {
            const tail = reference.slice("step.".length);
            const separator = tail.lastIndexOf(".");
            if (separator > 0) {
                const stepId = tail.slice(0, separator);
                const output = tail.slice(separator + 1);
                const outputs = this.stepOutputs.get(stepId);
                if (outputs && output in outputs) return outputs[output];
            }
        }
        return failure(
            "run.binding.unresolved-reference",
            `Reference '${reference}' has no committed value.`,
            "binding",
            { reference },
        );
    }

    private validateOutputs(step: Step, outputs: Record<string, JsonValue>): RunFailure | undefined {
        const declared = step.outputTypes ?? {};
        for (const [name, expectedType] of Object.entries(declared)) {
            if (!(name in outputs)) {
                return failure(
                    "run.output.missing",
                    `Step '${step.id}' did not produce declared output '${name}'.`,
                    "output",
                    { output: name, expectedType },
                );
            }
            if (valueType(outputs[name]) !== expectedType) {
                return failure(
                    "run.output.type",
                    `Step '${step.id}' produced the wrong type for output '${name}'.`,
                    "output",
                    { output: name, expectedType, receivedType: valueType(outputs[name]) },
                );
            }
        }
        for (const name of Object.keys(outputs)) {
            if (!(name in declared)) {
                return failure(
                    "run.output.unknown",
                    `Step '${step.id}' produced undeclared output '${name}'.`,
                    "output",
                    { output: name },
                );
            }
        }
        return undefined;
    }

    private pumpVirtualResults(): void {
        while (this.status === "running") {
            const resultId = [...this.ready]
                .sort()
                .find((stepId) => this.plan.steps.get(stepId)?.type === "result");
            if (!resultId) return;
            const step = this.plan.steps.get(resultId)!;
            this.ready.delete(resultId);
            this.stepStates.set(resultId, "running");
            this.record({ kind: "step", state: "running", stepId: resultId });
            const resolved = this.resolveBindings(step);
            if (isFailure(resolved)) {
                this.stepStates.set(resultId, "failed");
                this.record({ kind: "step", state: "failed", stepId: resultId });
                this.observeFailure({ ...resolved, stepId: resultId });
                return;
            }
            this.stepStates.set(resultId, "succeeded");
            this.stepOutputs.set(resultId, resolved);
            this.record({ kind: "step", state: "succeeded", stepId: resultId });
            this.succeed(resolved);
        }
    }

    private observeFailure(runFailure: RunFailure): void {
        this.observedFailures.push(runFailure);
        this.status = "stopping";
        this.ready.clear();
        if (this.active.size === 0) this.finishFailure();
    }

    private finishFailure(): void {
        const sortedFailures = [...this.observedFailures].sort((left, right) => {
            const leftKey = `${left.stepId ?? ""}:${left.conditionalId ?? ""}:${left.code}:${left.path ?? ""}`;
            const rightKey = `${right.stepId ?? ""}:${right.conditionalId ?? ""}:${right.code}:${right.path ?? ""}`;
            return leftKey.localeCompare(rightKey);
        });
        this.terminalFailures.splice(0, this.terminalFailures.length, ...sortedFailures);
        this.status = "failed";
        this.markPendingNotSelected();
        this.record({ kind: "run", state: "failed" });
    }

    private succeed(output: Record<string, JsonValue>): void {
        if (this.active.size > 0) {
            this.observeFailure(
                failure(
                    "run.scheduler.ambiguous-terminal",
                    "A terminal result was reached while another step was still running.",
                    "scheduler",
                    { activeSteps: [...this.active].sort() },
                ),
            );
            return;
        }
        this.output = output;
        this.status = "succeeded";
        this.markPendingNotSelected();
        this.record({ kind: "run", state: "succeeded" });
    }

    private checkQuiescence(): void {
        if (this.status === "stopping" && this.active.size === 0) {
            this.finishFailure();
            return;
        }
        if (this.status === "running" && this.active.size === 0 && this.ready.size === 0) {
            this.observeFailure(
                failure(
                    "run.scheduler.deadlock",
                    "The run has no active or ready step and has not reached a terminal result.",
                    "scheduler",
                    {},
                ),
            );
        }
    }

    private markPendingNotSelected(): void {
        for (const [stepId, state] of this.stepStates) {
            if (state === "pending" || state === "ready") this.stepStates.set(stepId, "notSelected");
        }
    }

    private record(event: Omit<TraceEvent, "sequence">): void {
        this.trace.push({ sequence: ++this.sequence, ...event });
    }
}
