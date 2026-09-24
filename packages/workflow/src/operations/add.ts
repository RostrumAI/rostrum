import { Type } from "typebox";
import type { OperationDeclaration } from "./operation-catalog";

/**
 * `add`: adds `left` and `right` and returns `value`. `right` is optional
 * with a default of 0. JSON numbers are always finite, but their sum can
 * overflow to infinity, which is reported as `numeric_overflow`.
 */
export const ADD_OPERATION = {
    name: "add",
    configSchema: Type.Object({}, { additionalProperties: false }),
    arguments: {
        left: { schema: Type.Number() },
        right: { schema: Type.Number(), default: 0 },
    },
    outputSchema: Type.Object({ value: Type.Number() }, { additionalProperties: false }),
    failureCodes: ["numeric_overflow"],
} as const satisfies OperationDeclaration;
