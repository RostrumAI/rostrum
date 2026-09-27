/** @fileoverview The `divide` operation. */

import { DIVIDE_OPERATION } from "@rostrum/workflow";
import type { OperationImplementation } from "./operation-registry";

/**
 * Divides `dividend` by `divisor`. A divisor of zero, positive or
 * negative, is `division_by_zero`; a quotient too large to represent is
 * `numeric_overflow`.
 */
export const DIVIDE: OperationImplementation<typeof DIVIDE_OPERATION> = {
    declaration: DIVIDE_OPERATION,
    execute({ inputs }) {
        // `-0 === 0`, so this catches both signs of zero.
        if (inputs.divisor === 0) {
            return Promise.resolve({
                ok: false,
                failure: {
                    code: "division_by_zero",
                    message: "The divisor is zero",
                    path: "/inputs/divisor",
                },
            });
        }
        const value = inputs.dividend / inputs.divisor;
        if (!Number.isFinite(value)) {
            return Promise.resolve({
                ok: false,
                failure: {
                    code: "numeric_overflow",
                    message: "The quotient is too large to represent",
                    path: "/outputs/value",
                },
            });
        }
        return Promise.resolve({ ok: true, output: { value } });
    },
};
