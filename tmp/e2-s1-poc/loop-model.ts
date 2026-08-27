import type { HandlerOutcome, JsonValue, RunFailure } from "./model";

export interface LoopIterationContext {
    index: number;
    item: JsonValue;
}

export interface LoopTraceEvent {
    iteration: number;
    state: "running" | "succeeded" | "failed";
    priorResultCount: number;
}

export type LoopExecutionResult =
    | {
          kind: "success";
          results: Array<Record<string, JsonValue>>;
          trace: LoopTraceEvent[];
          maximumConcurrentIterations: number;
      }
    | {
          kind: "failure";
          failure: RunFailure;
          results: Array<Record<string, JsonValue>>;
          trace: LoopTraceEvent[];
          maximumConcurrentIterations: number;
      };

export async function executeSequentialLoop(
    collection: JsonValue[],
    maxIterations: number,
    executeIteration: (context: LoopIterationContext) => HandlerOutcome | Promise<HandlerOutcome>,
): Promise<LoopExecutionResult> {
    const results: Array<Record<string, JsonValue>> = [];
    const trace: LoopTraceEvent[] = [];
    let activeIterations = 0;
    let maximumConcurrentIterations = 0;

    if (collection.length > maxIterations) {
        return {
            kind: "failure",
            failure: {
                code: "run.loop.max-iterations-exceeded",
                message: "The loop collection exceeds maxIterations.",
                phase: "loop",
                details: { collectionLength: collection.length, maxIterations },
            },
            results,
            trace,
            maximumConcurrentIterations,
        };
    }

    for (let index = 0; index < collection.length; index += 1) {
        const priorResultCount = results.length;
        activeIterations += 1;
        maximumConcurrentIterations = Math.max(maximumConcurrentIterations, activeIterations);
        trace.push({ iteration: index, state: "running", priorResultCount });

        let outcome: HandlerOutcome;
        try {
            outcome = await executeIteration({ index, item: collection[index] });
        } catch (cause) {
            activeIterations -= 1;
            trace.push({ iteration: index, state: "failed", priorResultCount });
            return {
                kind: "failure",
                failure: {
                    code: "run.loop.iteration-threw",
                    message: "A loop iteration threw instead of returning a handler outcome.",
                    phase: "loop",
                    details: { iteration: index, causeType: typeof cause },
                },
                results,
                trace,
                maximumConcurrentIterations,
            };
        }

        activeIterations -= 1;
        if (outcome.kind === "failure") {
            trace.push({ iteration: index, state: "failed", priorResultCount });
            return {
                kind: "failure",
                failure: {
                    ...outcome.failure,
                    code: "run.loop.iteration-failed",
                    phase: "loop",
                    details: {
                        iteration: index,
                        handlerCode: outcome.failure.code,
                    },
                },
                results,
                trace,
                maximumConcurrentIterations,
            };
        }

        if (
            typeof outcome.outputs !== "object" ||
            outcome.outputs === null ||
            Array.isArray(outcome.outputs)
        ) {
            trace.push({ iteration: index, state: "failed", priorResultCount });
            return {
                kind: "failure",
                failure: {
                    code: "run.loop.invalid-iteration-output",
                    message: "A loop iteration must produce one explicit output object.",
                    phase: "loop",
                    details: { iteration: index },
                },
                results,
                trace,
                maximumConcurrentIterations,
            };
        }

        results.push(outcome.outputs);
        trace.push({ iteration: index, state: "succeeded", priorResultCount });
    }

    return {
        kind: "success",
        results,
        trace,
        maximumConcurrentIterations,
    };
}
