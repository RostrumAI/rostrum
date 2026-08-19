export const UUID = {
  wf: "0192b0a0-7e1d-7000-8000-000000000001",
  s1: "0192b0a0-7e1d-7000-8000-000000000002",
  s2: "0192b0a0-7e1d-7000-8000-000000000003",
  s3: "0192b0a0-7e1d-7000-8000-000000000004",
  s4: "0192b0a0-7e1d-7000-8000-000000000005",
  s5: "0192b0a0-7e1d-7000-8000-000000000006",
  c1: "0192b0a0-7e1d-7000-8000-000000000012",
  c2: "0192b0a0-7e1d-7000-8000-000000000013",
  loopBody: "0192b0a0-7e1d-7000-8000-000000000032",
};

export function validSequential() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Greet and summarize",
    firstNode: UUID.s1,
    inputs: { name: { type: "string" } },
    steps: [
      {
        id: UUID.s1,
        type: "task",
        config: { operation: "greet" },
        inputs: { name: { ref: "inputs.name" } },
        outputs: { greeting: { type: "string" } },
        successors: [UUID.s2],
      },
      {
        id: UUID.s2,
        type: "result",
        inputs: { greeting: { ref: `step.${UUID.s1}.greeting` } },
      },
    ],
  };
}

export function cycleWorkflow() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Cycle",
    firstNode: UUID.s1,
    steps: [
      { id: UUID.s1, type: "task", config: { operation: "a" }, successors: [UUID.s2] },
      { id: UUID.s2, type: "task", config: { operation: "b" }, successors: [UUID.s1] },
    ],
  };
}

export function unreachableDependency() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Unreachable dependency",
    firstNode: UUID.s1,
    steps: [
      { id: UUID.s1, type: "task", config: { operation: "evaluate" }, outputs: { choice: { type: "string" } }, conditional: UUID.c1 },
      { id: UUID.s2, type: "task", config: { operation: "a" }, outputs: { v: { type: "string" } }, successors: [UUID.s4] },
      { id: UUID.s3, type: "task", config: { operation: "b" }, outputs: { v: { type: "string" } }, successors: [UUID.s4] },
      {
        id: UUID.s4,
        type: "task",
        config: { operation: "join" },
        inputs: { v: { ref: `step.${UUID.s2}.v` } },
        dependencies: [UUID.s2],
        successors: [UUID.s5],
      },
      { id: UUID.s5, type: "result", inputs: {} },
    ],
    conditionals: [
      {
        id: UUID.c1,
        dependencies: [UUID.s1],
        branches: [
          { label: "a", priority: 0, condition: { ref: `step.${UUID.s1}.choice`, op: "eq", value: "a" }, next: UUID.s2 },
          { label: "b", priority: 1, condition: { ref: `step.${UUID.s1}.choice`, op: "eq", value: "b" }, next: UUID.s3 },
        ],
        default: { label: "fallback", next: UUID.s3 },
      },
    ],
  };
}

export function missingBranchTarget() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Missing target",
    firstNode: UUID.s1,
    steps: [
      { id: UUID.s1, type: "task", config: { operation: "a" }, successors: ["0192b0a0-7e1d-7000-8000-000000099999"] },
      { id: UUID.s2, type: "result", inputs: {} },
    ],
  };
}

export function nestedLoopWorkflow() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Nested loop",
    firstNode: UUID.s1,
    steps: [
      {
        id: UUID.s1,
        type: "task",
        config: { operation: "list" },
        loop: { collection: { ref: "inputs.files" }, maxIterations: 10, variable: "file", body: UUID.loopBody },
        successors: [UUID.s2],
      },
      {
        id: UUID.loopBody,
        type: "task",
        config: { operation: "analyze" },
        loop: { collection: { ref: "loop.file" }, maxIterations: 5, variable: "x", body: UUID.s3 },
      },
      { id: UUID.s3, type: "task", config: { operation: "inner" }, inputs: { x: { ref: "loop.x" } } },
      { id: UUID.s2, type: "result", inputs: {} },
    ],
    inputs: { files: { type: "array", items: { type: "string" } } },
  };
}

export function invalidLoopBound() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Bad loop bound",
    firstNode: UUID.s1,
    steps: [
      {
        id: UUID.s1,
        type: "task",
        config: { operation: "list" },
        loop: { collection: { ref: "inputs.files" }, maxIterations: 0, variable: "file", body: UUID.loopBody },
      },
      { id: UUID.loopBody, type: "task", config: { operation: "analyze" }, inputs: { file: { ref: "loop.file" } } },
    ],
    inputs: { files: { type: "array", items: { type: "string" } } },
  };
}

export function conditionalMissingDependency() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Conditional missing dep",
    firstNode: UUID.s1,
    steps: [
      { id: UUID.s1, type: "task", config: { operation: "evaluate" }, outputs: { v: { type: "string" } }, conditional: UUID.c1 },
      { id: UUID.s2, type: "result", inputs: {} },
      { id: UUID.s3, type: "result", inputs: {} },
    ],
    conditionals: [
      {
        id: UUID.c1,
        dependencies: [],
        branches: [{ label: "a", priority: 0, condition: { ref: `step.${UUID.s1}.v`, op: "eq", value: "a" }, next: UUID.s2 }],
        default: { label: "fallback", next: UUID.s3 },
      },
    ],
  };
}

export function unterminatedPath() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Unterminated",
    firstNode: UUID.s1,
    steps: [
      { id: UUID.s1, type: "task", config: { operation: "a" }, successors: [UUID.s2] },
      { id: UUID.s2, type: "task", config: { operation: "b" } }, // terminal but not result, not end-branch
    ],
  };
}

export function conditionalEndsWorkflow() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Conditional ends workflow",
    firstNode: UUID.s1,
    steps: [
      { id: UUID.s1, type: "task", config: { operation: "evaluate" }, outputs: { score: { type: "number" } }, conditional: UUID.c1 },
      { id: UUID.s2, type: "result", inputs: { score: { ref: `step.${UUID.s1}.score` } } },
    ],
    conditionals: [
      {
        id: UUID.c1,
        dependencies: [UUID.s1],
        branches: [{ label: "high", priority: 0, condition: { ref: `step.${UUID.s1}.score`, op: "gte", value: 80 }, next: UUID.s2 }],
        default: { label: "end", /* no next -> ends workflow */ },
      },
    ],
  };
}

export function unknownStepType() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Unknown type",
    firstNode: UUID.s1,
    steps: [{ id: UUID.s1, type: "no-such-type" }],
  };
}

export function refUnknownOutput() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Bad ref",
    firstNode: UUID.s1,
    steps: [
      { id: UUID.s1, type: "task", config: { operation: "a" }, outputs: { greeting: { type: "string" } }, successors: [UUID.s2] },
      { id: UUID.s2, type: "result", inputs: { greeting: { ref: `step.${UUID.s1}.missing` } } },
    ],
  };
}

export function fanOutWorkflow() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Fan out",
    firstNode: UUID.s1,
    steps: [
      { id: UUID.s1, type: "task", config: { operation: "start" }, outputs: { diff: { type: "string" } }, successors: [UUID.s2, UUID.s3] },
      { id: UUID.s2, type: "task", config: { operation: "a" }, inputs: { diff: { ref: `step.${UUID.s1}.diff` } }, outputs: { r: { type: "string" } } },
      { id: UUID.s3, type: "task", config: { operation: "b" }, inputs: { diff: { ref: `step.${UUID.s1}.diff` } }, outputs: { r: { type: "string" } } },
      {
        id: UUID.s4,
        type: "task",
        config: { operation: "join" },
        inputs: { a: { ref: `step.${UUID.s2}.r` }, b: { ref: `step.${UUID.s3}.r` } },
        outputs: { r: { type: "string" } },
        dependencies: [UUID.s2, UUID.s3],
        successors: [UUID.s5],
      },
      { id: UUID.s5, type: "result", inputs: { a: { ref: `step.${UUID.s4}.r` } } },
    ],
  };
}

export function loopBodyCycle() {
  return {
    interfaceVersion: "v1",
    id: UUID.wf,
    name: "Loop body cycle",
    firstNode: UUID.s1,
    steps: [
      {
        id: UUID.s1,
        type: "task",
        config: { operation: "list" },
        outputs: { fileList: { type: "array", items: { type: "string" } } },
        loop: { collection: { ref: `step.${UUID.s1}.fileList` }, maxIterations: 5, variable: "f", body: UUID.s2 },
        successors: [UUID.s5],
      },
      { id: UUID.s2, type: "task", config: { operation: "a" }, successors: [UUID.s3] },
      { id: UUID.s3, type: "task", config: { operation: "b" }, successors: [UUID.s2] }, // cycle inside body
      { id: UUID.s5, type: "result", inputs: {} },
    ],
  };
}
