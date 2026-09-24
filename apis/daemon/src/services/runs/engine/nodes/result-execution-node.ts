/** @fileoverview Result steps: their resolved inputs become the run's final result. */

import type { PreparedResultStep } from "../../preparation/prepared-workflow";
import type { BindingContext } from "../bindings";
import type { ReadyVisit, VisitState } from "../run-state";
import {
    type CompletionDecision,
    ExecutionNode,
    type ExecutionPreparation,
} from "./execution-node";

/** A result step's decisions: no executor, and its output is the final result, exactly. */
export class ResultExecutionNode extends ExecutionNode<PreparedResultStep> {
    /** Resolves the bindings; the resolved object, even an empty one, is committed as is. */
    prepareExecution(_visit: ReadyVisit, context: BindingContext): ExecutionPreparation {
        const inputs = this.resolveInputs(context);
        if (!inputs.ok) {
            return { kind: "failure", failure: inputs.failure };
        }
        return { kind: "local", output: inputs.values };
    }

    /** Finishes the run with the committed output as its result. */
    completeExecution(
        _visit: VisitState,
        output: Readonly<Record<string, unknown>>,
    ): CompletionDecision {
        return { kind: "finish", result: output };
    }
}
