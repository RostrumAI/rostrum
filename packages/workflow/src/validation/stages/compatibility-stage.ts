import type { Finding } from "../../findings";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";

/**
 * Stage 8: input and output compatibility.
 *
 * Static compatibility in v1 is limited to the existence and ordering
 * checks stage 7 performs: the validator never compares the producer's
 * and consumer's JSON Schema fragments, so a run may still fail when a
 * produced value does not satisfy a consumer (E1-S2). The stage exists
 * to hold that boundary and reserves the code
 * `workflow.io.type-mismatch` for a future interface version that makes
 * type compatibility blocking; v1 bindings carry no consumer-side
 * schema, so there is nothing to compare and the stage emits nothing.
 */
export class CompatibilityStage implements ValidationStage {
    readonly id = "compatibility";
    readonly prerequisites: readonly string[] = ["references"];

    /** Emits no findings in v1; see the reserved `workflow.io.type-mismatch` contract. */
    run(_context: ValidationContext): Finding[] {
        return [];
    }
}
