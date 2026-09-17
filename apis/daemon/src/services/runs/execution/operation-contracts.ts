import { type TSchema, Type } from "typebox";

/**
 * The deterministic operations one task step can declare.
 *
 * A task step's `config` is exactly the supported operation declaration, and
 * its `inputs` and `outputs` are the operation's data contract. Publication
 * validation accepts any task configuration, so these declarations are what
 * decides whether a published step can execute: the daemon rejects an unknown
 * operation or an unknown configuration member during preparation instead of
 * running something it does not implement.
 *
 * Built-ins perform no I/O and no external side effect. Every operation
 * consumes JSON and returns JSON.
 */

/** The operation names this release executes. */
export const TASK_OPERATION_NAMES = ["add", "divide", "greet"] as const;

/** One operation name this release executes. */
export type TaskOperationName = (typeof TASK_OPERATION_NAMES)[number];

/** The validated configuration of one task step. */
export interface TaskOperationConfig {
    /** The operation the step declares. */
    readonly operation: TaskOperationName;
}

/**
 * One supported operation and the schemas of its configuration, inputs, and
 * outputs.
 *
 * The input schema describes the fully resolved input object: a required
 * member must be bound by every step that uses the operation, and an optional
 * member may be omitted. The output schema describes the whole object the
 * operation returns, so an operation cannot return an undeclared member.
 */
export interface TaskOperation {
    /** The operation name a task config declares. */
    readonly name: TaskOperationName;
    /** The closed configuration schema: the operation name and nothing else. */
    readonly configSchema: TSchema;
    /** The closed input schema for one execution of the operation. */
    readonly inputSchema: TSchema;
    /** The closed output schema for one execution of the operation. */
    readonly outputSchema: TSchema;
}

/** `greet` returns a greeting for one name. */
const GREET_OPERATION: TaskOperation = {
    name: "greet",
    configSchema: Type.Object(
        { operation: Type.Literal("greet") },
        { additionalProperties: false },
    ),
    inputSchema: Type.Object({ name: Type.String() }, { additionalProperties: false }),
    outputSchema: Type.Object({ greeting: Type.String() }, { additionalProperties: false }),
};

/** `add` returns the sum of two finite numbers. */
const ADD_OPERATION: TaskOperation = {
    name: "add",
    configSchema: Type.Object({ operation: Type.Literal("add") }, { additionalProperties: false }),
    inputSchema: Type.Object(
        { left: Type.Number(), right: Type.Optional(Type.Number()) },
        { additionalProperties: false },
    ),
    outputSchema: Type.Object({ value: Type.Number() }, { additionalProperties: false }),
};

/** `divide` returns the quotient of two finite numbers. */
const DIVIDE_OPERATION: TaskOperation = {
    name: "divide",
    configSchema: Type.Object(
        { operation: Type.Literal("divide") },
        { additionalProperties: false },
    ),
    inputSchema: Type.Object(
        { dividend: Type.Number(), divisor: Type.Number() },
        { additionalProperties: false },
    ),
    outputSchema: Type.Object({ value: Type.Number() }, { additionalProperties: false }),
};

/** Every operation this release executes. */
export const TASK_OPERATIONS: readonly TaskOperation[] = Object.freeze([
    ADD_OPERATION,
    DIVIDE_OPERATION,
    GREET_OPERATION,
]);

/** Every operation this release executes, keyed by the name a task config declares. */
const OPERATION_BY_NAME: Readonly<Record<string, TaskOperation>> = Object.freeze(
    Object.fromEntries(TASK_OPERATIONS.map((operation) => [operation.name, operation])),
);

/**
 * Finds the operation a task config declares.
 *
 * The lookup is guarded by an own-member test: a configuration value such as
 * `__proto__` or `constructor` names no operation even though the object
 * every operation table inherits from carries those names.
 */
export function findTaskOperation(name: string): TaskOperation | undefined {
    return Object.hasOwn(OPERATION_BY_NAME, name) ? OPERATION_BY_NAME[name] : undefined;
}
