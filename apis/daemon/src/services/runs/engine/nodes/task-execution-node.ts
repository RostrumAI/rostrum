/** @fileoverview Task steps: run an operation, then move on to the successors. */

import type { PreparedTaskStep } from "../../preparation/prepared-workflow";
import type { BindingContext } from "../bindings";
import type { ReadyVisit, VisitState } from "../run-state";
import {
    type CompletionDecision,
    ExecutionNode,
    type ExecutionPreparation,
} from "./execution-node";

/** A task step's decisions: dispatch its operation, then reach its successors. */
export class TaskExecutionNode extends ExecutionNode<PreparedTaskStep> {
    /** Resolves the arguments, defaults included, and hands them to the executor. */
    prepareExecution(_visit: ReadyVisit, context: BindingContext): ExecutionPreparation {
        const inputs = this.resolveInputs(context);
        if (!inputs.ok) {
            return { kind: "failure", failure: inputs.failure };
        }
        return { kind: "task", config: this.step.config, inputs: inputs.values };
    }

    /** Continues to every successor, carrying the visit's metadata along. */
    completeExecution(visit: VisitState): CompletionDecision {
        return {
            kind: "continue",
            successors: this.step.successors.map((stepId) => ({
                stepId,
                metadata: visit.metadata,
            })),
        };
    }
}
