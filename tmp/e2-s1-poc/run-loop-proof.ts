import { executeSequentialLoop } from "./loop-model";
import type { HandlerOutcome } from "./model";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const observedStarts: number[] = [];
const successful = await executeSequentialLoop(["a", "b", "c"], 3, async ({ index, item }) => {
    observedStarts.push(index);
    await Promise.resolve();
    return {
        kind: "success",
        outputs: { index, value: String(item).toUpperCase() },
    };
});
assert(successful.kind === "success", "Sequential loop did not succeed");
assert(
    JSON.stringify(observedStarts) === JSON.stringify([0, 1, 2]),
    "Loop iterations did not start in collection order",
);
assert(successful.maximumConcurrentIterations === 1, "Loop ran more than one iteration at once");
assert(
    JSON.stringify(successful.results) ===
        JSON.stringify([
            { index: 0, value: "A" },
            { index: 1, value: "B" },
            { index: 2, value: "C" },
        ]),
    "Loop results did not preserve collection order",
);
assert(
    successful.trace
        .filter((event) => event.state === "running")
        .every((event) => event.priorResultCount === event.iteration),
    "An iteration started before every prior result committed",
);

const emptyOutputs = await executeSequentialLoop([1, 2], 2, () => ({
    kind: "success",
    outputs: {},
}));
assert(emptyOutputs.kind === "success", "Explicit empty outputs did not succeed");
assert(
    emptyOutputs.results.every((result) => Object.keys(result).length === 0),
    "Explicit empty outputs changed shape",
);

const attemptedIterations: number[] = [];
const failed = await executeSequentialLoop(["a", "b", "c"], 3, ({ index }) => {
    attemptedIterations.push(index);
    if (index === 1) {
        return {
            kind: "failure",
            failure: {
                code: "run.handler.fixture-failure",
                message: "Fixture failure.",
                phase: "handler",
                details: {},
            },
        } satisfies HandlerOutcome;
    }
    return { kind: "success", outputs: { index } } satisfies HandlerOutcome;
});
assert(failed.kind === "failure", "Failed iteration did not fail the loop");
assert(failed.failure.code === "run.loop.iteration-failed", "Loop failure code changed");
assert(
    JSON.stringify(attemptedIterations) === JSON.stringify([0, 1]),
    "Loop started an iteration after failure",
);

const overLimit = await executeSequentialLoop([1, 2, 3], 2, () => ({
    kind: "success",
    outputs: {},
}));
assert(overLimit.kind === "failure", "Over-limit collection did not fail");
assert(
    overLimit.failure.code === "run.loop.max-iterations-exceeded",
    "Loop maximum failure code changed",
);
assert(overLimit.trace.length === 0, "Over-limit loop started an iteration");

console.log(
    JSON.stringify(
        {
            sequential: {
                status: successful.kind,
                starts: observedStarts,
                results: successful.results,
                maximumConcurrentIterations: successful.maximumConcurrentIterations,
                priorResultsCommittedBeforeNext: true,
            },
            explicitEmptyOutput: {
                status: emptyOutputs.kind,
                results: emptyOutputs.results,
            },
            failureStopsLaterIterations: {
                status: failed.kind,
                attemptedIterations,
                code: failed.failure.code,
            },
            maxIterations: {
                status: overLimit.kind,
                startedIterations: overLimit.trace.length,
                code: overLimit.failure.code,
            },
        },
        null,
        2,
    ),
);
