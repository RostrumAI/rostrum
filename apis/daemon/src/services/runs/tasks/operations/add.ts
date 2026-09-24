/** @fileoverview The `add` operation. */

import { ADD_OPERATION } from "@rostrum/workflow";
import type { OperationImplementation } from "./operation-registry";

/** Adds `left` and `right`; a sum too large to represent is `numeric_overflow`. */
export const ADD: OperationImplementation<typeof ADD_OPERATION> = {
    declaration: ADD_OPERATION,
    execute({ inputs }) {
        const value = inputs.left + inputs.right;
        if (!Number.isFinite(value)) {
            return Promise.resolve({
                ok: false,
                failure: {
                    code: "numeric_overflow",
                    message: "The sum is too large to represent",
                    path: "/outputs/value",
                },
            });
        }
        return Promise.resolve({ ok: true, output: { value } });
    },
};
