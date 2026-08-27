import { executeSequentialLoop } from "./loop-model";
import {
    accept,
    type HandlerOutcome,
    type JsonValue,
    type ReferenceRun,
    type Workflow,
} from "./model";

const SUPPORTED_OPERATIONS = new Set(["emit", "work"]);
const EMPTY_SUCCESS: HandlerOutcome = { kind: "success", outputs: {} };

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function iterationWorkflow(): Workflow {
    return {
        firstNode: "iteration-root",
        inputTypes: { item: "string" },
        steps: [
            {
                id: "iteration-root",
                type: "task",
                operation: "emit",
                outputTypes: { item: "string" },
                successors: ["branch-a", "branch-b"],
            },
            {
                id: "branch-a",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["iteration-result"],
            },
            {
                id: "branch-b",
                type: "task",
                operation: "work",
                outputTypes: {},
                successors: ["iteration-result"],
            },
            {
                id: "iteration-result",
                type: "result",
                dependencies: ["branch-a", "branch-b"],
                inputs: { item: { ref: "step.iteration-root.item" } },
            },
        ],
    };
}

function runIteration(item: string, dispatchWidths: number[]): Record<string, JsonValue> {
    const accepted = accept(iterationWorkflow(), { item }, SUPPORTED_OPERATIONS);
    if (!accepted.accepted) throw new Error(`Iteration workflow rejected: ${accepted.failure.code}`);
    const run: ReferenceRun = accepted.run;
    run.start();

    while (run.status === "running") {
        const dispatched = run.dispatchReady(2);
        dispatchWidths.push(dispatched.length);
        assert(dispatched.length > 0, "Iteration graph stopped before reaching its result");
        for (const dispatch of dispatched) {
            run.complete(
                dispatch.stepId,
                dispatch.stepId === "iteration-root"
                    ? { kind: "success", outputs: { item } }
                    : EMPTY_SUCCESS,
            );
        }
    }

    assert(run.status === "succeeded", "Iteration graph did not succeed");
    return run.output ?? {};
}

const dispatchWidthsByIteration: number[][] = [];
const integrated = await executeSequentialLoop(["a", "b", "c"], 3, ({ index, item }) => {
    const widths: number[] = [];
    dispatchWidthsByIteration[index] = widths;
    return {
        kind: "success",
        outputs: runIteration(String(item), widths),
    };
});

assert(integrated.kind === "success", "Integrated loop did not succeed");
assert(integrated.maximumConcurrentIterations === 1, "Integrated loop overlapped iterations");
assert(
    dispatchWidthsByIteration.every((widths) => widths.includes(2)),
    "An iteration did not dispatch its fan-out cohort at capacity two",
);
assert(
    JSON.stringify(integrated.results) ===
        JSON.stringify([{ item: "a" }, { item: "b" }, { item: "c" }]),
    "Integrated loop results changed collection order",
);

console.log(
    JSON.stringify(
        {
            status: integrated.kind,
            results: integrated.results,
            maximumConcurrentIterations: integrated.maximumConcurrentIterations,
            dispatchWidthsByIteration,
            structuredFanoutInsideEachIteration: true,
        },
        null,
        2,
    ),
);
