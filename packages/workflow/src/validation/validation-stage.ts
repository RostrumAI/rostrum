import type { Finding } from "../findings";
import type { ValidationContext } from "./validation-context";

/**
 * One validation stage.
 *
 * A stage declares the stage ids whose blocking findings gate it. The
 * pipeline runs stages in list order and skips a stage when any
 * prerequisite produced a blocking finding, so later stages only run
 * when earlier results provide enough reliable information (E1-S2).
 */
export interface ValidationStage {
  /** Stable stage id used in prerequisite declarations. */
  readonly id: string;
  /** Stage ids whose blocking findings gate this stage. */
  readonly prerequisites: readonly string[];
  /** Runs the stage against the context and returns its findings. */
  run(context: ValidationContext): Finding[];
}

/**
 * Runs validation stages in order with prerequisite gating.
 *
 * A stage runs only when every prerequisite ran and none of them
 * produced a blocking finding; a stage whose prerequisite was itself
 * gated is also gated, so blocking propagates down the whole chain.
 * The pipeline returns the collected findings unsorted; the caller
 * applies the pointer-then-code ordering.
 */
export class ValidationPipeline {
  private readonly stages: readonly ValidationStage[];

  /** Constructs a pipeline over stages in execution order. */
  constructor(stages: readonly ValidationStage[]) {
    this.stages = stages;
  }

  /** Runs every ungated stage and returns the collected findings. */
  run(context: ValidationContext): Finding[] {
    const blocked = new Set<string>();
    const ran = new Set<string>();
    const findings: Finding[] = [];
    for (const stage of this.stages) {
      const ready = stage.prerequisites.every((id) => ran.has(id) && !blocked.has(id));
      if (!ready) continue;
      ran.add(stage.id);
      const produced = stage.run(context);
      findings.push(...produced);
      if (produced.some((finding) => finding.blocking)) blocked.add(stage.id);
    }
    return findings;
  }
}
