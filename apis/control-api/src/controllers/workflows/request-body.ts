/** @fileoverview Strict workflow request-body decoding and document text extraction. */

import { type DocumentNode, parse as parseJsonAst } from "@humanwhocodes/momoa";
import type { ControllerBodyDecoder } from "@rostrum/server/request";
import { parseWorkflow } from "@rostrum/workflow";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { errorBody, invalidWorkflowInput, workflowParseFailure } from "./errors";

/**
 * Decodes one declared workflow request body, preserving its exact source
 * text. The body is read once and parsed strictly: duplicate keys,
 * `NaN`/`Infinity` literals, and invalid UTF-8 answer 400 carrying the parse
 * findings, and a document that does not satisfy the operation's schema
 * answers 400 `invalid_workflow_input`. A failure never reaches a controller.
 */
export const decodeWorkflowBody: ControllerBodyDecoder = async (request, schema) => {
    // The framework reads the body once and hands over the bytes it received.
    const parsed = parseWorkflow(new Uint8Array(await request.arrayBuffer()));
    if (!parsed.ok) {
        return {
            ok: false,
            response: Response.json(errorBody(workflowParseFailure(parsed.findings)), {
                status: 400,
            }),
        };
    }

    // Only the application's own decoder checks the schema, so the wording
    // stays this module's and never becomes the framework's.
    if (!Value.Check(schema, parsed.document)) {
        const message = requestBodyError(schema, parsed.document);
        return {
            ok: false,
            response: Response.json(errorBody(invalidWorkflowInput(message)), { status: 400 }),
        };
    }

    return { ok: true, decoded: { body: parsed.document, text: parsed.text } };
};

/** Builds the 400 message for a request body that does not satisfy its schema. */
function requestBodyError(schema: TSchema, value: unknown): string {
    const errors = [...Value.Errors(schema, value)];
    const first = errors[0];
    if (first === undefined) return "The request body does not satisfy the operation schema";
    const location = first.instancePath === "" ? "the body" : `the body at ${first.instancePath}`;
    return `The request body is not valid: ${location} ${first.message}`;
}

/**
 * Returns the exact source text of the `document` member of a valid request
 * body, so the stored revision keeps the author's formatting byte-for-byte
 * and its findings anchor to the text retrieval returns.
 */
export function extractDocumentText(text: string): string {
    let document: DocumentNode;
    try {
        document = parseJsonAst(text, { mode: "json", ranges: true });
    } catch (error) {
        // The body parsed strictly already; a failure here is an
        // invariant violation, not client input.
        throw new Error(`request body re-parse failed: ${(error as Error).message}`);
    }
    const root = document.body;
    if (root.type !== "Object") {
        throw new Error("request body re-parse produced no root object");
    }
    const member = root.members.find(
        (candidate) =>
            (candidate.name.type === "String" ? candidate.name.value : candidate.name.name) ===
            "document",
    );
    const range = member?.value.range;
    if (range === undefined) {
        throw new Error("request body re-parse produced no document member range");
    }
    return text.slice(range[0], range[1]);
}
