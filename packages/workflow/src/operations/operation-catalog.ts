import type { Static, TObject, TSchema } from "typebox";
import type { JsonSchema } from "../declared-schemas/declared-schema-compiler";
import type { FailureCode } from "../execution/schemas";
import { ADD_OPERATION } from "./add";
import { DIVIDE_OPERATION } from "./divide";
import { GREET_OPERATION } from "./greet";

/**
 * One argument an operation accepts: a schema and an optional default,
 * the same shape as a workflow input declaration. An argument with a
 * default is optional: a task that leaves it unbound receives the default.
 */
export interface OperationArgument<Schema extends TSchema = TSchema> {
    /** The schema every bound or default value must satisfy. */
    readonly schema: Schema;
    /** The value an unbound argument receives; absent means the argument must be bound. */
    readonly default?: Static<Schema>;
}

/**
 * What an operation is, without how it runs: its name, configuration
 * schema, arguments, output schema, and the failure codes it can return.
 *
 * Publication validation and daemon preparation both read declarations,
 * so they agree on what a task may bind and produce; only the daemon holds
 * implementations. Every schema uses only the keywords the containment
 * check can compare, and the output schema is as tight as the
 * implementation guarantees, because authors can't tighten it.
 */
export interface OperationDeclaration {
    /** The name a task's `config.operation` selects. */
    readonly name: string;
    /** The schema for the task's `config` without its `operation` member. */
    readonly configSchema: TSchema;
    /** The arguments a task binds through its `inputs`, by name. */
    readonly arguments: Readonly<Record<string, OperationArgument>>;
    /** The closed schema of the object the operation returns; every member is required. */
    readonly outputSchema: TObject;
    /** The catalog failure codes the operation reports, beyond invalid inputs. */
    readonly failureCodes: readonly FailureCode[];
}

/** The resolved argument values an operation receives: every argument, bound or defaulted. */
export type OperationInputs<Declaration extends OperationDeclaration> = {
    readonly [Name in keyof Declaration["arguments"]]: Static<
        Declaration["arguments"][Name]["schema"]
    >;
};

/** The output object an operation returns. */
export type OperationOutput<Declaration extends OperationDeclaration> = Static<
    Declaration["outputSchema"]
>;

/** The operations a release can execute, by name. */
export type OperationCatalog = ReadonlyMap<string, OperationDeclaration>;

/**
 * The operation catalog of this release. Publication validation checks
 * tasks against it, and the daemon pairs each declaration with its
 * implementation.
 */
export const OPERATION_CATALOG: OperationCatalog = new Map<string, OperationDeclaration>(
    [GREET_OPERATION, ADD_OPERATION, DIVIDE_OPERATION].map((operation) => [
        operation.name,
        operation,
    ]),
);

/**
 * Views a catalog schema as the JSON Schema the compiler and containment
 * check read. TypeBox builds plain JSON Schema objects, keeping its own
 * metadata in non-enumerable members; only its interface lacks the index
 * signature.
 */
export function toJsonSchema(schema: TSchema): JsonSchema {
    return schema as JsonSchema;
}
