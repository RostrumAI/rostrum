/** @fileoverview Declared request input tests: JSON bodies and path parameters. */

import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { decodeJsonBody, validatePathParameters } from "./request";

const bodySchema = Type.Object({ value: Type.String() });

/** Builds a request whose body is the supplied text. */
function withBody(text: string): Request {
    return new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
    });
}

describe("JSON body decoding", () => {
    test("returns the decoded value and the body's exact source text", async () => {
        const text = '{\n  "value": "first"\n}';
        const result = await decodeJsonBody(withBody(text), bodySchema);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.decoded.body).toEqual({ value: "first" });
        // Byte-exact text is what operations that store documents rely on.
        expect(result.decoded.text).toBe(text);
    });

    test("answers 400 for a body that is not JSON, or not the declared shape", async () => {
        const malformed = await decodeJsonBody(withBody("{"), bodySchema);
        expect(malformed.ok).toBe(false);
        if (malformed.ok) return;
        expect(malformed.response.status).toBe(400);
        expect(await malformed.response.json()).toEqual({
            code: "invalid_request_body",
            message: "The request body is not valid JSON",
            findings: [],
        });

        const mismatched = await decodeJsonBody(withBody('{"value": 1}'), bodySchema);
        expect(mismatched.ok).toBe(false);
        if (mismatched.ok) return;
        expect(mismatched.response.status).toBe(400);
        expect(await mismatched.response.json()).toEqual({
            code: "invalid_request_body",
            message: "The request body is not valid: the body at /value must be string",
            findings: [],
        });
    });
});

describe("path parameter validation", () => {
    const schema = Type.Object({ itemId: Type.String({ minLength: 3 }) });

    test("returns the validated parameters", () => {
        const result = validatePathParameters(schema, (name) =>
            name === "itemId" ? "abc" : undefined,
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.params).toEqual({ itemId: "abc" });
    });

    test("answers 400 naming an invalid or missing parameter", async () => {
        const invalid = validatePathParameters(schema, () => "no");
        expect(invalid.ok).toBe(false);
        if (invalid.ok) return;
        expect(invalid.response.status).toBe(400);
        expect(await invalid.response.json()).toEqual({
            code: "invalid_parameter",
            message: "'no' is not a valid itemId: must not have fewer than 3 characters",
            findings: [],
        });

        const missing = validatePathParameters(schema, () => undefined);
        expect(missing.ok).toBe(false);
        if (missing.ok) return;
        expect(await missing.response.json()).toEqual({
            code: "invalid_parameter",
            message: "the path parameter itemId is required",
            findings: [],
        });
    });
});
