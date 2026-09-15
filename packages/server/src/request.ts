/** @fileoverview Declared request inputs: strict JSON bodies and path parameters. */

import type { Static, TObject, TSchema } from "typebox";
import { Value } from "typebox/value";

/** A request body that decoded and satisfied its declared schema. */
export interface DecodedBody {
    /** The decoded value. */
    readonly body: unknown;
    /** The body's exact source text. */
    readonly text: string;
}

/**
 * The outcome of decoding a declared request body. A failure carries the
 * response the caller receives, so the application that owns the error shape
 * decides the wording.
 */
export type ControllerBodyResult =
    | {
          /** The body decoded and validated. */
          readonly ok: true;
          /** The decoded value and its source text. */
          readonly decoded: DecodedBody;
      }
    | {
          /** The body could not be accepted. */
          readonly ok: false;
          /** The response the caller receives. */
          readonly response: Response;
      };

/**
 * Reads, decodes, and validates a declared request body. An application whose
 * documents need stricter decoding than JSON supplies its own decoder and
 * keeps its own error contract; the framework owns the read-once sequencing.
 */
export type ControllerBodyDecoder = (
    request: Request,
    schema: TSchema,
) => Promise<ControllerBodyResult>;

/** Builds the standard 400 body: `{ code, message, findings }`. */
export function controllerErrorBody(code: string, message: string): Record<string, unknown> {
    return { code, message, findings: [] };
}

/**
 * The framework's default decoder: reads the body once as UTF-8 text, parses
 * it as JSON, and validates it against the declared schema. Applications that
 * must reject duplicate keys or retain byte-exact member text supply their own
 * decoder instead.
 */
export const decodeJsonBody: ControllerBodyDecoder = async (request, schema) => {
    const text = await request.text();

    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch {
        return {
            ok: false,
            response: Response.json(
                controllerErrorBody("invalid_request_body", "The request body is not valid JSON"),
                { status: 400 },
            ),
        };
    }

    if (!Value.Check(schema, value)) {
        return {
            ok: false,
            response: Response.json(
                controllerErrorBody("invalid_request_body", bodySchemaMessage(schema, value)),
                { status: 400 },
            ),
        };
    }

    return { ok: true, decoded: { body: value, text } };
};

/**
 * Validates the path parameters a route declares against their schema. An
 * absent required parameter is named as missing; an invalid one quotes the
 * value the caller sent.
 */
export function validatePathParameters<Params extends TObject>(
    schema: Params,
    value: (name: string) => string | undefined,
):
    | { readonly ok: true; readonly params: Static<Params> }
    | { readonly ok: false; readonly response: Response } {
    const parsed: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(schema.properties) as [string, TSchema][]) {
        const supplied = value(name);
        if (supplied === undefined) {
            return {
                ok: false,
                response: Response.json(
                    controllerErrorBody(
                        "invalid_parameter",
                        `the path parameter ${name} is required`,
                    ),
                    { status: 400 },
                ),
            };
        }
        if (!Value.Check(property, supplied)) {
            const errors = [...Value.Errors(property, supplied)];
            const detail = errors[0]?.message ?? "it does not match the documented schema";
            return {
                ok: false,
                response: Response.json(
                    controllerErrorBody(
                        "invalid_parameter",
                        `'${supplied}' is not a valid ${name}: ${detail}`,
                    ),
                    { status: 400 },
                ),
            };
        }
        parsed[name] = supplied;
    }

    return { ok: true, params: parsed as Static<Params> };
}

/** Names the first schema violation without quoting the caller's value. */
function bodySchemaMessage(schema: TSchema, value: unknown): string {
    const first = [...Value.Errors(schema, value)][0];
    if (first === undefined) {
        return "The request body does not satisfy the operation schema";
    }
    const location = first.instancePath === "" ? "the body" : `the body at ${first.instancePath}`;
    return `The request body is not valid: ${location} ${first.message}`;
}
