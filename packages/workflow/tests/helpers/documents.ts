import type { WorkflowConditional, WorkflowDocument, WorkflowStep } from "../../src/schema";

let nextId = 0;

/** Mints a deterministic UUID v7-shaped identifier for tests. */
export function testId(): string {
    nextId += 1;
    return `0192b0a0-7e1d-7000-8000-${nextId.toString(16).padStart(12, "0")}`;
}

/** Builds a `task` step with a placeholder operation, overridden per test. */
export function taskStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
    return {
        id: overrides.id ?? testId(),
        type: "task",
        config: { operation: "work" },
        ...overrides,
    };
}

/** Builds a `task` step carrying a bounded-loop configuration. */
export function taskLoopStep(
    loop: NonNullable<WorkflowStep["loop"]>,
    overrides: Partial<WorkflowStep> = {},
): WorkflowStep {
    return taskStep({ ...overrides, loop });
}

/** Builds a terminal `result` step, overridden per test. */
export function resultStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
    return { id: overrides.id ?? testId(), type: "result", inputs: {}, ...overrides };
}

/** Builds a conditional, overridden per test. */
export function conditional(overrides: Partial<WorkflowConditional> = {}): WorkflowConditional {
    const id = overrides.id ?? testId();
    return {
        id,
        dependencies: overrides.dependencies ?? [],
        branches: overrides.branches ?? [
            {
                label: "always",
                priority: 0,
                condition: { ref: `step.${id}.output`, op: "eq", value: "x" },
                next: undefined,
            },
        ],
        default: overrides.default ?? { label: "fallback" },
    };
}

/**
 * Builds a shape-valid document. Steps default to a single terminal
 * `result` step; `firstNode` defaults to the first step.
 */
export function buildDocument(overrides: Partial<WorkflowDocument> = {}): WorkflowDocument {
    const { steps: overrideSteps, ...rest } = overrides;
    const steps = overrideSteps ?? [resultStep()];
    return {
        interfaceVersion: "v1",
        id: testId(),
        name: "Test workflow",
        firstNode: rest.firstNode ?? steps[0]?.id ?? testId(),
        steps,
        ...rest,
    };
}
