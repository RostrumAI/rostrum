/** @fileoverview The `greet` operation. */

import { GREET_OPERATION } from "@rostrum/workflow";
import type { OperationImplementation } from "./operation-registry";

/** Returns `Hello, <name>!`. It has no domain failures. */
export const GREET: OperationImplementation<typeof GREET_OPERATION> = {
    declaration: GREET_OPERATION,
    execute({ inputs }) {
        return Promise.resolve({ ok: true, output: { greeting: `Hello, ${inputs.name}!` } });
    },
};
