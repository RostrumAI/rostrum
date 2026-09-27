/** @fileoverview The daemon's operation implementations, paired with their catalog declarations. */

import type {
    OperationCatalog,
    OperationDeclaration,
    OperationInputs,
    OperationOutput,
} from "@rostrum/workflow";
import { ADD } from "./add";
import { DIVIDE } from "./divide";
import { GREET } from "./greet";

/** What an operation receives for one task: its configuration, resolved arguments, and abort signal. */
export interface OperationRequest<Declaration extends OperationDeclaration> {
    /** The task's validated `config`, including `operation`. */
    readonly config: Readonly<Record<string, unknown>>;
    /** Every argument, bound or defaulted, already checked against the declaration. */
    readonly inputs: OperationInputs<Declaration>;
    /** Aborted when the daemon asks the operation to stop, such as at its deadline. */
    readonly signal: AbortSignal;
}

/** A domain failure an operation reports, drawn from its declared failure codes. */
export interface OperationFailure<Declaration extends OperationDeclaration> {
    /** One of the declaration's failure codes. */
    readonly code: Declaration["failureCodes"][number];
    /** A sanitized explanation that doesn't repeat the inputs. */
    readonly message: string;
    /** JSON Pointer relative to the step: `/inputs/<argument>` or `/outputs/<member>`. */
    readonly path: string;
}

/** An operation's result: its output, or a declared domain failure. */
export type OperationOutcome<Declaration extends OperationDeclaration> =
    | {
          /** The operation produced its output. */
          readonly ok: true;
          /** The output object, which the engine validates before committing it. */
          readonly output: OperationOutput<Declaration>;
      }
    | {
          /** The operation reported a domain failure. */
          readonly ok: false;
          /** The failure. */
          readonly failure: OperationFailure<Declaration>;
      };

/**
 * How one operation runs. The contract is asynchronous: an implementation
 * may do I/O and should stop when its signal aborts. Anything it needs
 * from outside, such as a client or credentials, is supplied when the
 * registry is built at startup, never in the request.
 */
export interface OperationImplementation<Declaration extends OperationDeclaration> {
    /** The catalog declaration this implementation fulfills. */
    readonly declaration: Declaration;
    /**
     * Runs the operation. The engine calls this only with inputs that
     * satisfy the declaration's argument schemas, which is why a
     * registered operation can accept the general request shape.
     */
    execute(request: OperationRequest<Declaration>): Promise<OperationOutcome<Declaration>>;
}

/** An implementation as the registry holds it, whatever its declaration. */
export type RegisteredOperation = OperationImplementation<OperationDeclaration>;

/** The operations this daemon can run, by name. */
export type OperationRegistry = ReadonlyMap<string, RegisteredOperation>;

/** Builds the static registry of built-in operations; there is no dynamic plugin loader. */
export function createOperationRegistry(): OperationRegistry {
    const operations: RegisteredOperation[] = [GREET, ADD, DIVIDE];
    return new Map(operations.map((operation) => [operation.declaration.name, operation]));
}

/**
 * The catalog this daemon prepares publications against: the declarations
 * of the operations it can actually run.
 */
export function getRegistryCatalog(registry: OperationRegistry): OperationCatalog {
    return new Map([...registry].map(([name, operation]) => [name, operation.declaration]));
}
