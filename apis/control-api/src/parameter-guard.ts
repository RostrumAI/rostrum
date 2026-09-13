/** @fileoverview OpenAPI-aligned path and header parameter validation. */

import type { ParameterDefinition } from "@rostrum/server/loader";
import type { MiddlewareHandler } from "hono";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";

/**
 * Guards a route's documented path and header parameters: every value must
 * satisfy the parameter schema. A violation answers 400 in the single error
 * shape before the handler runs, so handlers never re-check parameter formats
 * by hand.
 *
 * Only the Control API documents parameterized routes today, so the guard stays
 * here rather than in the shared package.
 */
export function parameterGuard(parameters: ParameterDefinition[]): MiddlewareHandler {
    // A declared parameter can only be checked when it carries a schema.
    const guarded = parameters.filter(
        (parameter): parameter is ParameterDefinition & { schema: TSchema } =>
            parameter.schema !== undefined,
    );
    if (guarded.length === 0) {
        return (_c, next) => next();
    }
    return async (c, next) => {
        for (const parameter of guarded) {
            // Read the value from where the parameter travels: a header must not be
            // looked up as a path token, and headers are matched case-insensitively.
            const value =
                parameter.in === "path"
                    ? c.req.param(parameter.name)
                    : c.req.header(parameter.name);
            const required = parameter.required ?? parameter.in === "path";

            // An absent optional parameter is not a violation.
            if (value === undefined && !required) {
                continue;
            }
            if (value !== undefined && Value.Check(parameter.schema, value)) {
                continue;
            }

            const errors = value === undefined ? [] : [...Value.Errors(parameter.schema, value)];
            const detail = errors[0]?.message ?? "the parameter is required";
            return c.json(
                {
                    code: "invalid_parameter",
                    message: `'${value}' is not a valid ${parameter.name}: ${detail}`,
                    findings: [],
                },
                400,
            );
        }
        await next();
    };
}
