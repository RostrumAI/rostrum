/** @fileoverview OpenAPI-aligned path-parameter validation middleware. */

import type { ParameterDefinition } from "@rostrum/server/loader";
import type { MiddlewareHandler } from "hono";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";

/**
 * Guards a route's path parameters: every value must satisfy the documented
 * parameter schema. A violation answers 400 in the single error shape before
 * the handler runs, so handlers never re-check parameter formats by hand.
 *
 * This stays in the Control API: `invalid_workflow_input` is the workflow
 * area's response, not a boundary concern both services share.
 */
export function parameterGuard(parameters: ParameterDefinition[]): MiddlewareHandler {
    const guarded = parameters.filter(
        (parameter): parameter is ParameterDefinition & { schema: TSchema } =>
            parameter.in === "path" && parameter.schema !== undefined,
    );
    if (guarded.length === 0) {
        return (_c, next) => next();
    }
    return async (c, next) => {
        for (const parameter of guarded) {
            const value = c.req.param(parameter.name);
            if (value !== undefined && Value.Check(parameter.schema, value)) {
                continue;
            }
            const errors = value === undefined ? [] : [...Value.Errors(parameter.schema, value)];
            const detail = errors[0]?.message ?? "the parameter is required";
            return c.json(
                {
                    code: "invalid_workflow_input",
                    message: `'${value}' is not a valid ${parameter.name}: ${detail}`,
                    findings: [],
                },
                400,
            );
        }
        await next();
    };
}
