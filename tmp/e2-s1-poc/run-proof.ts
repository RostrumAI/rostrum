import {
    accept,
    type HandlerContract,
    type HandlerOutcome,
    type JsonValue,
    type ReferenceRun,
    validateHandlerContracts,
    type Workflow,
} from "./model";

const SUPPORTED_OPERATIONS = new Set(["copy", "classify", "work", "join"]);
const EMPTY_SUCCESS: HandlerOutcome = { kind: "success", outputs: {} };

function handlerFailure(code: string): HandlerOutcome {
    return {
        kind: "failure",
        failure: {
            code,
            message: `Handler failed with '${code}'.`,
            phase: "handler",
            details: {},
        },
    };
}

function requireAccepted(
    workflow: Workflow,
    inputs: Record<string, JsonValue>,
): ReferenceRun {
    const result = accept(workflow, inputs, SUPPORTED_OPERATIONS);
    if (!result.accepted) throw new Error(`Invocation rejected: ${result.failure.code}`);
    return result.run;
}

function drive(
    run: ReferenceRun,
    outcomes: Record<string, HandlerOutcome>,
    order: "forward" | "reverse" = "forward",
    capacity = Number.POSITIVE_INFINITY,
    dispatchWidths: number[] = [],
): ReferenceRun {
    run.start();
    while (run.status === "running" || run.status === "stopping") {
        const dispatched = run.dispatchReady(capacity);
        dispatchWidths.push(dispatched.length);
        const ordered = order === "forward" ? dispatched : [...dispatched].reverse();
        if (ordered.length === 0) {
            if (run.status === "running") throw new Error("Proof driver found no dispatchable work");
            break;
        }
        for (const item of ordered) {
            run.complete(item.stepId, outcomes[item.stepId] ?? EMPTY_SUCCESS);
        }
    }
    return run;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function sequentialWorkflow(): Workflow {
    return {
        firstNode: "copy",
        inputTypes: { name: "string" },
        steps: [
            {
                id: "copy",
                type: "task",
                operation: "copy",
                inputs: { name: { ref: "inputs.name" } },
                outputTypes: { greeting: "string" },
                successors: ["result"],
            },
            {
                id: "result",
                type: "result",
                inputs: { greeting: { ref: "step.copy.greeting" } },
            },
        ],
    };
}

function branchingWorkflow(): Workflow {
    return {
        firstNode: "classify",
        inputTypes: { approved: "boolean" },
        steps: [
            {
                id: "classify",
                type: "task",
                operation: "classify",
                outputTypes: { approved: "boolean" },
                conditional: "route",
            },
            {
                id: "approved-path",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["result"],
            },
            {
                id: "rejected-path",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["result"],
            },
            {
                id: "result",
                type: "result",
                inputs: { approved: { ref: "step.classify.approved" } },
            },
        ],
        conditionals: [
            {
                id: "route",
                branches: [
                    {
                        label: "approved",
                        priority: 0,
                        condition: { ref: "step.classify.approved", op: "eq", value: true },
                        next: "approved-path",
                    },
                ],
                default: { label: "rejected", next: "rejected-path" },
            },
        ],
    };
}

function conditionalFanoutWorkflow(): Workflow {
    return {
        firstNode: "classify",
        inputTypes: { approved: "boolean" },
        steps: [
            {
                id: "classify",
                type: "task",
                operation: "classify",
                outputTypes: { approved: "boolean" },
                conditional: "route",
            },
            {
                id: "approved-split",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["approved-a", "approved-b"],
            },
            {
                id: "approved-a",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["approved-result"],
            },
            {
                id: "approved-b",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["approved-result"],
            },
            {
                id: "approved-result",
                type: "result",
                dependencies: ["approved-a", "approved-b"],
                inputs: { approved: { ref: "step.classify.approved" } },
            },
            {
                id: "rejected-split",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["rejected-a", "rejected-b"],
            },
            {
                id: "rejected-a",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["rejected-result"],
            },
            {
                id: "rejected-b",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["rejected-result"],
            },
            {
                id: "rejected-result",
                type: "result",
                dependencies: ["rejected-a", "rejected-b"],
                inputs: { approved: { ref: "step.classify.approved" } },
            },
        ],
        conditionals: [
            {
                id: "route",
                branches: [
                    {
                        label: "approved",
                        priority: 0,
                        condition: { ref: "step.classify.approved", op: "eq", value: true },
                        next: "approved-split",
                    },
                ],
                default: { label: "rejected", next: "rejected-split" },
            },
        ],
    };
}

function fanoutWorkflow(): Workflow {
    return {
        firstNode: "root",
        inputTypes: {},
        steps: [
            {
                id: "root",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["a", "b"],
            },
            {
                id: "a",
                type: "task",
                operation: "work",
                outputTypes: { value: "string" },
                successors: ["join"],
            },
            {
                id: "b",
                type: "task",
                operation: "work",
                outputTypes: { value: "string" },
                successors: ["join"],
            },
            {
                id: "join",
                type: "task",
                operation: "join",
                dependencies: ["a", "b"],
                inputs: {
                    a: { ref: "step.a.value" },
                    b: { ref: "step.b.value" },
                },
                outputTypes: { combined: "string" },
                successors: ["result"],
            },
            {
                id: "result",
                type: "result",
                inputs: { combined: { ref: "step.join.combined" } },
            },
        ],
    };
}

function makeChain(length: number): Workflow {
    const steps: Workflow["steps"] = [];
    for (let index = 0; index < length; index += 1) {
        steps.push({
            id: `step-${index.toString().padStart(5, "0")}`,
            type: "task",
            operation: "work",
            outputTypes: {},
            successors: [
                index === length - 1
                    ? "result"
                    : `step-${(index + 1).toString().padStart(5, "0")}`,
            ],
        });
    }
    steps.push({ id: "result", type: "result", inputs: {} });
    return { firstNode: steps[0].id, inputTypes: {}, steps };
}

function makeWideJoin(width: number): Workflow {
    const branchIds = Array.from(
        { length: width },
        (_, index) => `branch-${index.toString().padStart(5, "0")}`,
    );
    return {
        firstNode: "root",
        inputTypes: {},
        steps: [
            {
                id: "root",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: branchIds,
            },
            ...branchIds.map((id) => ({
                id,
                type: "task" as const,
                operation: "work",
                outputTypes: {},
                successors: ["join"],
            })),
            {
                id: "join",
                type: "task",
                operation: "join",
                dependencies: branchIds,
                outputTypes: {},
                successors: ["result"],
            },
            { id: "result", type: "result", inputs: {} },
        ],
    };
}

const proofs: Record<string, unknown> = {};

const missingInput = accept(sequentialWorkflow(), {}, SUPPORTED_OPERATIONS);
assert(!missingInput.accepted, "Missing input must reject the invocation");
assert(missingInput.failure.code === "run.input.missing", "Missing input code changed");
proofs.invocationRejection = { accepted: false, code: missingInput.failure.code };

const unknownInput = accept(
    sequentialWorkflow(),
    { name: "Ada", undeclared: true },
    SUPPORTED_OPERATIONS,
);
assert(!unknownInput.accepted, "Unknown input must reject the invocation");
assert(unknownInput.failure.code === "run.input.unknown", "Unknown input code changed");
proofs.unknownInput = { accepted: false, code: unknownInput.failure.code };

const unsupported = sequentialWorkflow();
unsupported.steps[0].operation = "unregistered";
const unsupportedResult = accept(unsupported, { name: "Ada" }, SUPPORTED_OPERATIONS);
assert(!unsupportedResult.accepted, "Unsupported handler must reject the invocation");
assert(unsupportedResult.failure.code === "run.step.unsupported", "Unsupported code changed");
proofs.unsupportedHandler = { accepted: false, code: unsupportedResult.failure.code };


const handlerContracts = new Map<string, HandlerContract>([
    [
        "typed",
        {
            requiredInputs: { required: "string" },
            optionalInputs: { optional: "number" },
            outputs: { result: "string" },
        },
    ],
]);
const contractWorkflow = (
    inputs: Workflow["steps"][number]["inputs"],
    outputTypes: Workflow["steps"][number]["outputTypes"],
): Workflow => ({
    firstNode: "typed-step",
    inputTypes: { source: "string" },
    steps: [
        {
            id: "typed-step",
            type: "task",
            operation: "typed",
            inputs,
            outputTypes,
            successors: ["result"],
        },
        {
            id: "result",
            type: "result",
            inputs: { result: { ref: "step.typed-step.result" } },
        },
    ],
});
const validContractFindings = validateHandlerContracts(
    contractWorkflow({ required: { ref: "inputs.source" } }, { result: "string" }),
    handlerContracts,
);
assert(validContractFindings.length === 0, "Valid handler contract produced findings");
const missingRequiredFindings = validateHandlerContracts(
    contractWorkflow({}, { result: "string" }),
    handlerContracts,
);
assert(
    missingRequiredFindings.some(
        (finding) => finding.code === "run.definition.handler-input-missing",
    ),
    "Missing required handler input was not found",
);
const optionalInputFindings = validateHandlerContracts(
    contractWorkflow(
        { required: { ref: "inputs.source" }, optional: 1 },
        { result: "string" },
    ),
    handlerContracts,
);
assert(optionalInputFindings.length === 0, "Valid optional handler input produced findings");
const outputContractFindings = validateHandlerContracts(
    contractWorkflow(
        { required: { ref: "inputs.source" } },
        { result: "string", undeclared: "boolean" },
    ),
    handlerContracts,
);
assert(
    outputContractFindings.some(
        (finding) => finding.code === "run.definition.handler-output-contract",
    ),
    "Output contract mismatch was not found statically",
);
proofs.handlerContracts = {
    valid: validContractFindings,
    missingRequired: missingRequiredFindings.map((finding) => finding.code),
    optionalOmittedOrProvided: true,
    outputMismatch: outputContractFindings.map((finding) => finding.code),
};
const duplicatePriority = branchingWorkflow();
duplicatePriority.conditionals![0].branches.push({
    label: "duplicate",
    priority: 0,
    condition: { ref: "step.classify.approved", op: "eq", value: false },
    next: "rejected-path",
});
const duplicatePriorityResult = accept(
    duplicatePriority,
    { approved: true },
    SUPPORTED_OPERATIONS,
);
assert(!duplicatePriorityResult.accepted, "Duplicate branch priority must reject the plan");
assert(
    duplicatePriorityResult.failure.code === "run.definition.duplicate-branch-priority",
    "Duplicate branch priority code changed",
);
proofs.duplicateBranchPriority = {
    accepted: false,
    code: duplicatePriorityResult.failure.code,
};

const conditionalEnd = branchingWorkflow();
delete conditionalEnd.conditionals![0].default.next;
const conditionalEndResult = accept(conditionalEnd, { approved: true }, SUPPORTED_OPERATIONS);
assert(!conditionalEndResult.accepted, "Conditional outcome without next must reject the plan");
assert(
    conditionalEndResult.failure.code === "run.definition.conditional-terminal",
    "Conditional terminal code changed",
);
proofs.explicitResultPath = {
    accepted: false,
    code: conditionalEndResult.failure.code,
};

const parallelTerminals: Workflow = {
    firstNode: "root",
    inputTypes: {},
    steps: [
        {
            id: "root",
            type: "task",
            operation: "work",
            outputTypes: {},
            successors: ["result-a", "result-b"],
        },
        { id: "result-a", type: "result", inputs: {} },
        { id: "result-b", type: "result", inputs: {} },
    ],
};
const parallelTerminalsInvocation = accept(parallelTerminals, {}, SUPPORTED_OPERATIONS);
assert(!parallelTerminalsInvocation.accepted, "Terminal steps inside fan-out must reject the plan");
assert(
    parallelTerminalsInvocation.failure.code === "run.definition.fanout-terminal",
    "Fan-out terminal code changed",
);
proofs.terminalCardinality = {
    accepted: false,
    code: parallelTerminalsInvocation.failure.code,
};

const conditionalInsideFanout: Workflow = {
    firstNode: "root",
    inputTypes: {},
    steps: [
        {
            id: "root",
            type: "task",
            operation: "work",
            outputTypes: {},
            successors: ["conditional-branch", "plain-branch"],
        },
        {
            id: "conditional-branch",
            type: "task",
            operation: "work",
            outputTypes: { matches: "boolean" },
            conditional: "inside-route",
        },
        {
            id: "plain-branch",
            type: "task",
            operation: "work",
            outputTypes: {},
            successors: ["joined-result"],
        },
        {
            id: "joined-result",
            type: "result",
            dependencies: ["conditional-branch", "plain-branch"],
            inputs: {},
        },
    ],
    conditionals: [
        {
            id: "inside-route",
            branches: [
                {
                    label: "matches",
                    priority: 0,
                    condition: {
                        ref: "step.conditional-branch.matches",
                        op: "eq",
                        value: true,
                    },
                    next: "joined-result",
                },
            ],
            default: { label: "default", next: "joined-result" },
        },
    ],
};
const conditionalInsideFanoutInvocation = accept(
    conditionalInsideFanout,
    {},
    SUPPORTED_OPERATIONS,
);
assert(!conditionalInsideFanoutInvocation.accepted, "Conditional inside fan-out must reject");
assert(
    conditionalInsideFanoutInvocation.failure.code === "run.definition.fanout-conditional",
    "Fan-out conditional code changed",
);
proofs.conditionalInsideFanout = {
    accepted: false,
    code: conditionalInsideFanoutInvocation.failure.code,
};

const sequential = drive(requireAccepted(sequentialWorkflow(), { name: "Ada" }), {
    copy: { kind: "success", outputs: { greeting: "Hello, Ada" } },
});
assert(sequential.status === "succeeded", "Sequential run did not succeed");
assert(sequential.output?.greeting === "Hello, Ada", "Sequential output did not bind");
proofs.sequential = {
    status: sequential.status,
    output: sequential.output,
    succeededSteps: sequential.trace
        .filter((event) => event.kind === "step" && event.state === "succeeded")
        .map((event) => event.stepId),
};

const branching = drive(requireAccepted(branchingWorkflow(), { approved: true }), {
    classify: { kind: "success", outputs: { approved: true } },
});
assert(branching.status === "succeeded", "Branching run did not succeed");
assert(branching.stepStates.get("approved-path") === "succeeded", "Selected branch did not run");
assert(branching.stepStates.get("rejected-path") === "notSelected", "Unselected branch ran");
proofs.branching = {
    status: branching.status,
    selected: branching.trace.find((event) => event.kind === "branch")?.branch,
    rejectedPathState: branching.stepStates.get("rejected-path"),
};

const approvedFanoutPath = drive(
    requireAccepted(conditionalFanoutWorkflow(), { approved: true }),
    { classify: { kind: "success", outputs: { approved: true } } },
);
const rejectedFanoutPath = drive(
    requireAccepted(conditionalFanoutWorkflow(), { approved: false }),
    { classify: { kind: "success", outputs: { approved: false } } },
);
assert(approvedFanoutPath.status === "succeeded", "Approved fan-out path did not succeed");
assert(rejectedFanoutPath.status === "succeeded", "Rejected fan-out path did not succeed");
assert(
    approvedFanoutPath.stepStates.get("approved-result") === "succeeded" &&
        approvedFanoutPath.stepStates.get("rejected-result") === "notSelected",
    "Approved conditional path did not select exactly one joined result",
);
assert(
    rejectedFanoutPath.stepStates.get("rejected-result") === "succeeded" &&
        rejectedFanoutPath.stepStates.get("approved-result") === "notSelected",
    "Rejected conditional path did not select exactly one joined result",
);
proofs.conditionalFanoutTerminals = {
    approved: approvedFanoutPath.output,
    rejected: rejectedFanoutPath.output,
    mutuallyExclusive: true,
};

const fanoutOutcomes: Record<string, HandlerOutcome> = {
    a: { kind: "success", outputs: { value: "A" } },
    b: { kind: "success", outputs: { value: "B" } },
    join: { kind: "success", outputs: { combined: "AB" } },
};

const positionRun = requireAccepted(fanoutWorkflow(), {});
positionRun.start();
const rootDispatch = positionRun.dispatchReady(1);
assert(rootDispatch.length === 1 && rootDispatch[0].stepId === "root", "Root did not dispatch");
positionRun.complete("root", EMPTY_SUCCESS);
const firstBranchDispatch = positionRun.dispatchReady(1);
assert(
    firstBranchDispatch.length === 1 && firstBranchDispatch[0].stepId === "a",
    "First fan-out branch did not dispatch",
);
const fanoutPosition = positionRun.currentSteps;
assert(
    JSON.stringify(fanoutPosition) ===
        JSON.stringify([
            { stepId: "a", state: "running" },
            { stepId: "b", state: "ready" },
        ]),
    "Current step projection did not expose ready and running fan-out steps",
);
positionRun.complete("a", fanoutOutcomes.a);
const secondBranchDispatch = positionRun.dispatchReady(1);
assert(
    secondBranchDispatch.length === 1 && secondBranchDispatch[0].stepId === "b",
    "Second fan-out branch did not dispatch",
);
positionRun.complete("b", fanoutOutcomes.b);
const joinDispatch = positionRun.dispatchReady(1);
assert(joinDispatch.length === 1 && joinDispatch[0].stepId === "join", "Join did not dispatch");
positionRun.complete("join", fanoutOutcomes.join);
assert(positionRun.status === "succeeded", "Current-position run did not succeed");
assert(positionRun.currentSteps.length === 0, "Terminal run retained current steps");
proofs.currentSteps = {
    duringFanout: fanoutPosition,
    afterTerminal: positionRun.currentSteps,
};
const fanoutForward = drive(requireAccepted(fanoutWorkflow(), {}), fanoutOutcomes, "forward");
const fanoutReverse = drive(requireAccepted(fanoutWorkflow(), {}), fanoutOutcomes, "reverse");
assert(fanoutForward.status === "succeeded", "Forward fan-out did not succeed");
assert(fanoutReverse.status === "succeeded", "Reverse fan-out did not succeed");
assert(
    JSON.stringify(fanoutForward.output) === JSON.stringify(fanoutReverse.output),
    "Completion order changed fan-out output",
);
proofs.fanoutCompletionOrder = {
    forward: fanoutForward.output,
    reverse: fanoutReverse.output,
    invariant: true,
};

const capacityOneWidths: number[] = [];
const capacityTwoWidths: number[] = [];
const fanoutCapacityOne = drive(
    requireAccepted(fanoutWorkflow(), {}),
    fanoutOutcomes,
    "forward",
    1,
    capacityOneWidths,
);
const fanoutCapacityTwo = drive(
    requireAccepted(fanoutWorkflow(), {}),
    fanoutOutcomes,
    "forward",
    2,
    capacityTwoWidths,
);
assert(fanoutCapacityOne.status === "succeeded", "Capacity-one fan-out did not succeed");
assert(fanoutCapacityTwo.status === "succeeded", "Capacity-two fan-out did not succeed");
assert(!capacityOneWidths.includes(2), "Capacity-one dispatcher started two handlers");
assert(capacityTwoWidths.includes(2), "Capacity-two dispatcher did not start the fan-out cohort");
assert(
    JSON.stringify(fanoutCapacityOne.output) === JSON.stringify(fanoutCapacityTwo.output),
    "Capacity changed fan-out output",
);
proofs.capacityBoundedFanout = {
    capacityOneDispatchWidths: capacityOneWidths,
    capacityTwoDispatchWidths: capacityTwoWidths,
    outputInvariant: true,
};

const failureOutcomes: Record<string, HandlerOutcome> = {
    a: handlerFailure("run.handler.a-failed"),
    b: handlerFailure("run.handler.b-failed"),
};
const failureForward = drive(requireAccepted(fanoutWorkflow(), {}), failureOutcomes, "forward");
const failureReverse = drive(requireAccepted(fanoutWorkflow(), {}), failureOutcomes, "reverse");
assert(failureForward.status === "failed", "Forward failure run did not fail");
assert(failureReverse.status === "failed", "Reverse failure run did not fail");
const forwardFailures = failureForward.terminalFailures.map(({ code, stepId }) => ({ code, stepId }));
const reverseFailures = failureReverse.terminalFailures.map(({ code, stepId }) => ({ code, stepId }));
assert(forwardFailures.length === 2, "Forward completion did not retain every observed failure");
assert(reverseFailures.length === 2, "Reverse completion did not retain every observed failure");
assert(
    JSON.stringify(forwardFailures) === JSON.stringify(reverseFailures),
    "Completion order changed the ordered failure list",
);
proofs.parallelFailures = {
    forward: forwardFailures,
    reverse: reverseFailures,
    allObservedFailuresRetained: true,
    invariant: true,
};

const badOutput = drive(requireAccepted(sequentialWorkflow(), { name: "Ada" }), {
    copy: { kind: "success", outputs: { greeting: 42 } },
});
assert(badOutput.status === "failed", "Invalid handler output did not fail the run");
assert(badOutput.terminalFailures[0]?.code === "run.output.type", "Output failure code changed");
proofs.outputValidation = {
    status: badOutput.status,
    failure: badOutput.terminalFailures[0],
};

const missingOutput = drive(requireAccepted(sequentialWorkflow(), { name: "Ada" }), {
    copy: { kind: "success", outputs: {} },
});
assert(missingOutput.status === "failed", "Missing handler output did not fail the run");
assert(missingOutput.terminalFailures[0]?.code === "run.output.missing", "Missing output code changed");

const unknownOutput = drive(requireAccepted(sequentialWorkflow(), { name: "Ada" }), {
    copy: {
        kind: "success",
        outputs: { greeting: "Hello, Ada", undeclared: true },
    },
});
assert(unknownOutput.status === "failed", "Unknown handler output did not fail the run");
assert(unknownOutput.terminalFailures[0]?.code === "run.output.unknown", "Unknown output code changed");
proofs.outputExactness = {
    missing: missingOutput.terminalFailures[0]?.code,
    unknown: unknownOutput.terminalFailures[0]?.code,
};

const unresolvedWorkflow = sequentialWorkflow();
unresolvedWorkflow.steps[0].inputs = { missing: { ref: "inputs.absent" } };
const unresolved = drive(requireAccepted(unresolvedWorkflow, { name: "Ada" }), {});
assert(unresolved.status === "failed", "Unresolved runtime binding did not fail the run");
assert(
    unresolved.terminalFailures[0]?.code === "run.binding.unresolved-reference",
    "Binding failure code changed",
);
proofs.unresolvedBinding = {
    status: unresolved.status,
    failure: unresolved.terminalFailures[0],
};

const chainLength = 10_000;
const chain = drive(requireAccepted(makeChain(chainLength), {}), {});
assert(chain.status === "succeeded", "Large chain did not succeed");
assert(
    chain.counters.successorEdgesVisited === chainLength,
    "Large chain did not visit each successor edge exactly once",
);
proofs.largeChain = {
    taskCount: chainLength,
    status: chain.status,
    counters: chain.counters,
};

const joinWidth = 5_000;
const wideJoin = drive(requireAccepted(makeWideJoin(joinWidth), {}), {});
assert(wideJoin.status === "succeeded", "Wide join did not succeed");
assert(
    wideJoin.counters.dependencyEdgesVisited === joinWidth,
    "Wide join did not visit each dependency edge exactly once",
);
proofs.wideJoin = {
    branchCount: joinWidth,
    status: wideJoin.status,
    counters: wideJoin.counters,
};

console.log(JSON.stringify(proofs, null, 2));
