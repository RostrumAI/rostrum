/** @fileoverview The decisions one kind of step contributes to execution. */

import type { ExecutionFailure } from "@rostrum/workflow/execution";
import type { PreparedStep, PreparedTaskStep } from "../../preparation/prepared-workflow";
import { type BindingContext, resolveBindings } from "../bindings";
import {
    createWaitingVisit,
    type ReadyVisit,
    type VisitMetadata,
    type VisitState,
    type WaitingVisit,
} from "../run-state";

/** What a ready visit needs next: task work, a result to commit, or a failure. */
export type ExecutionPreparation =
    | {
          /** Hand the work to the task executor. */
          readonly kind: "task";
          /** The prepared task step the work runs. */
          readonly step: PreparedTaskStep;
          /** The resolved, checked inputs. */
          readonly inputs: Readonly<Record<string, unknown>>;
      }
    | {
          /** Commit these values as the visit's output without running any work. */
          readonly kind: "local";
          /** The values to commit. */
          readonly output: Readonly<Record<string, unknown>>;
      }
    | {
          /** The visit can't run; fail it before any work starts. */
          readonly kind: "failure";
          /** The located failure. */
          readonly failure: ExecutionFailure;
      };

/** One visit the run should reach next: a target step and its metadata. */
export interface SuccessorVisit {
    /** The step to visit. */
    readonly stepId: string;
    /** The metadata the visit carries. */
    readonly metadata: VisitMetadata;
}

/** What a completed visit means for the run: continue to successors, or finish with a result. */
export type CompletionDecision =
    | {
          /** Continue: make sure these visits exist. */
          readonly kind: "continue";
          /** The visits to reach; asking for an existing visit returns it unchanged. */
          readonly successors: readonly SuccessorVisit[];
      }
    | {
          /** Finish: this is the run's final result. */
          readonly kind: "finish";
          /** The final result. */
          readonly result: Readonly<Record<string, unknown>>;
      };

/**
 * How one kind of step behaves: how it creates a visit, prepares a ready
 * visit's work, and interprets a committed output. Nodes read the run but
 * never change it; the engine applies every decision they return, so a
 * later conditional or loop node reuses the same state owner.
 */
export abstract class ExecutionNode<Step extends PreparedStep = PreparedStep> {
    /** The prepared step this node describes. */
    protected readonly step: Step;

    /** Binds the node to its prepared step. */
    constructor(step: Step) {
        this.step = step;
    }

    /**
     * Creates this step's visit for the given metadata. Every predecessor
     * asking for the same step and metadata gets the same identity,
     * whichever asked first.
     */
    createVisit(metadata: VisitMetadata, at: string): WaitingVisit {
        return createWaitingVisit(this.step.id, metadata, at);
    }

    /**
     * Returns the dependency step IDs that haven't completed, given a
     * lookup of completed steps for the visit's metadata. A failed
     * dependency never counts as completed.
     */
    getUnmetDependencies(isCompleted: (stepId: string) => boolean): string[] {
        return this.step.dependencies.filter((dependency) => !isCompleted(dependency));
    }

    /** Resolves and checks a ready visit's inputs and says what work, if any, it needs. */
    abstract prepareExecution(visit: ReadyVisit, context: BindingContext): ExecutionPreparation;

    /** Interprets a committed output: the successors to reach, or the run's result. */
    abstract completeExecution(
        visit: VisitState,
        output: Readonly<Record<string, unknown>>,
    ): CompletionDecision;

    /**
     * Resolves the step's bindings and checks each value its consumer
     * declares. A value that fails its check can't be dispatched.
     */
    protected resolveInputs(
        context: BindingContext,
    ):
        | { ok: true; values: Readonly<Record<string, unknown>> }
        | { ok: false; failure: ExecutionFailure } {
        const resolved = resolveBindings(this.step.inputs, context, this.step.id);
        if (!resolved.ok) {
            return resolved;
        }
        for (const [name, input] of this.step.inputs) {
            const value = Object.getOwnPropertyDescriptor(resolved.values, name)?.value;
            const [failure] =
                input.check?.(value, {
                    path: input.path,
                    code: "io_type_mismatch",
                    stepId: this.step.id,
                }) ?? [];
            if (failure) {
                return { ok: false, failure };
            }
        }
        return resolved;
    }
}
