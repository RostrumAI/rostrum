import { Type } from "typebox";
import type { OperationDeclaration } from "./operation-catalog";

/**
 * `divide`: divides `dividend` by `divisor` and returns `value`. A divisor
 * of zero, of either sign, is `division_by_zero`; a quotient that
 * overflows to infinity is `numeric_overflow`.
 */
export const DIVIDE_OPERATION = {
    name: "divide",
    configSchema: Type.Object({}, { additionalProperties: false }),
    arguments: {
        dividend: { schema: Type.Number() },
        divisor: { schema: Type.Number() },
    },
    outputSchema: Type.Object({ value: Type.Number() }, { additionalProperties: false }),
    failureCodes: ["division_by_zero", "numeric_overflow"],
} as const satisfies OperationDeclaration;
