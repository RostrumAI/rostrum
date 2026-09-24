/** @fileoverview The immutable, process-local form of a publication the engine executes. */

import type { OperationDeclaration } from "@rostrum/workflow";
import type { RunPublication } from "@rostrum/workflow/execution";
import type { ValueChecker } from "./value-checks";

/**
 * Where one bound value comes from. A literal is owned by the prepared
 * workflow, including an operation argument's default; a workflow input
 * belongs to the run; a step output is read from a completed visit.
 */
export type PreparedBinding =
    | {
          /** A value fixed by the publication: a literal binding or an argument default. */
          readonly kind: "literal";
          /** The value, deep-frozen so no run can change it. */
          readonly value: unknown;
      }
    | {
          /** A reference to one of the run's accepted workflow inputs. */
          readonly kind: "workflow-input";
          /** The workflow input's declared name. */
          readonly inputName: string;
      }
    | {
          /** A reference to a committed output of a completed step. */
          readonly kind: "step-output";
          /** The step that produces the value. */
          readonly stepId: string;
          /** The output member the step commits. */
          readonly outputName: string;
      };

/** One named value a step receives, with where it comes from and where it's declared. */
export interface PreparedInput {
    /** Where the value comes from. */
    readonly binding: PreparedBinding;
    /** JSON Pointer to the binding in the publication, for located failures. */
    readonly path: string;
    /** Checks the resolved value before dispatch; absent for result-step inputs, which have no consumer. */
    readonly check?: ValueChecker;
}

/** What every prepared step has, whatever its type. */
interface PreparedStepBase {
    /** The step's ID. */
    readonly id: string;
    /** The step's position in the document's `steps`, which is display order. */
    readonly index: number;
    /** JSON Pointer to the step in the publication. */
    readonly path: string;
    /** Distinct steps this step's completion leads to. */
    readonly successors: readonly string[];
    /** Steps that must complete before this step may run. */
    readonly dependencies: readonly string[];
    /** The step's inputs by name, in document order. */
    readonly inputs: ReadonlyMap<string, PreparedInput>;
}

/** A task step: an operation the executor runs with resolved arguments. */
export interface PreparedTaskStep extends PreparedStepBase {
    /** Distinguishes task steps from result steps. */
    readonly kind: "task";
    /** The operation's catalog declaration. */
    readonly operation: OperationDeclaration;
    /** The task's `config`, including `operation`, deep-frozen. */
    readonly config: Readonly<Record<string, unknown>>;
    /** Checks a returned output against the operation's output schema. */
    readonly outputCheck: ValueChecker;
    /** Checks each declared output member against the step's own declaration. */
    readonly declaredOutputs: ReadonlyMap<string, ValueChecker>;
}

/** A result step: its resolved inputs become the run's final result. */
export interface PreparedResultStep extends PreparedStepBase {
    /** Distinguishes result steps from task steps. */
    readonly kind: "result";
}

/** One prepared step. */
export type PreparedStep = PreparedTaskStep | PreparedResultStep;

/** One declared workflow input: its value check and optional default. */
export interface PreparedWorkflowInput {
    /** Checks an invocation's value for this input. */
    readonly check: ValueChecker;
    /** Present when the input is optional; holds the deep-frozen default. */
    readonly default?: { readonly value: unknown };
}

/**
 * A publication this daemon release can execute: its identity, entry
 * step, every step by ID with its links, bindings, and compiled checks,
 * and the declared workflow inputs. It holds no run progress and isn't
 * JSON; any daemon on the same release rebuilds an equivalent one from the
 * publication.
 */
export interface PreparedWorkflow {
    /** The exact publication this was prepared from. */
    readonly publication: RunPublication;
    /** The step where execution begins. */
    readonly entryStepId: string;
    /** Every declared step by ID, reachable or not. */
    readonly steps: ReadonlyMap<string, PreparedStep>;
    /** Step IDs in document order, for inspection. */
    readonly stepOrder: readonly string[];
    /** The declared workflow inputs by name. */
    readonly inputs: ReadonlyMap<string, PreparedWorkflowInput>;
}
