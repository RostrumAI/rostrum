import { Type } from "typebox";
import type { OperationDeclaration } from "./operation-catalog";

/**
 * `greet`: takes a string `name` and returns `greeting`, `Hello, <name>!`.
 * It has no domain failures; an invalid name is refused before dispatch.
 */
export const GREET_OPERATION = {
    name: "greet",
    configSchema: Type.Object({}, { additionalProperties: false }),
    arguments: {
        name: { schema: Type.String() },
    },
    outputSchema: Type.Object(
        {
            // "Hello, " and "!" surround the name, so a greeting is at least 8 characters.
            greeting: Type.String({ minLength: 8, pattern: "^Hello, [\\s\\S]*!$" }),
        },
        { additionalProperties: false },
    ),
    failureCodes: [],
} as const satisfies OperationDeclaration;
