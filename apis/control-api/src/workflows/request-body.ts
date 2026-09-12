import { type DocumentNode, parse as parseJsonAst } from "@humanwhocodes/momoa";
import { parseWorkflow } from "@rostrum/workflow";
import type { Context } from "hono";
import type { Static, TObject, TSchema } from "typebox";
import { Value } from "typebox/value";
import { invalidWorkflowInput, WorkflowApiError, workflowParseFailure } from "./errors";

/** The strictly parsed JSON request body of a workflow operation. */
export interface ParsedBody {
    /** The body's exact text after UTF-8 decoding. */
    readonly text: string;
    /** The parsed value. */
    readonly value: unknown;
}

/**
 * Reads and strictly parses the JSON request body. Duplicate keys,
 * `NaN`/`Infinity` literals, and invalid UTF-8 are parse failures: they
 * answer 400 carrying the parse findings, never a draft.
 */
export async function parseWorkflowBody(c: Context): Promise<ParsedBody> {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const parsed = parseWorkflow(bytes);
    if (!parsed.ok) throw new WorkflowApiError(workflowParseFailure(parsed.findings));
    return { text: parsed.text, value: parsed.document };
}

/**
 * Reads, strictly parses, and validates a request body against the
 * operation's schema, then returns the parsed value plus the exact
 * source text of its `document` member. The document text keeps the
 * author's formatting byte-for-byte, so the stored revision's findings
 * anchor to the text retrieval returns.
 */
export async function readRequestBody<T extends TObject>(
    c: Context,
    schema: T,
): Promise<{ request: Static<T>; documentText: string }> {
    const body = await parseWorkflowBody(c);
    if (!Value.Check(schema, body.value)) {
        throw new WorkflowApiError(invalidWorkflowInput(requestBodyError(schema, body.value)));
    }
    return {
        request: body.value as Static<T>,
        documentText: extractMemberText(body.text, "document"),
    };
}

/**
 * Reads, strictly parses, and validates a JSON body against the
 * operation's schema, returning the typed value.
 */
export async function readValidatedBody<T extends TObject>(
    c: Context,
    schema: T,
): Promise<Static<T>> {
    const body = await parseWorkflowBody(c);
    if (!Value.Check(schema, body.value)) {
        throw new WorkflowApiError(invalidWorkflowInput(requestBodyError(schema, body.value)));
    }
    return body.value as Static<T>;
}

/** Builds the 400 message for a request body that does not satisfy its schema. */
function requestBodyError(schema: TSchema, value: unknown): string {
    const errors = [...Value.Errors(schema, value)];
    const first = errors[0];
    if (first === undefined) return "The request body does not satisfy the operation schema";
    const location = first.instancePath === "" ? "the body" : `the body at ${first.instancePath}`;
    return `The request body is not valid: ${location} ${first.message}`;
}

/** Returns the exact source text of one root member of strictly valid JSON. */
function extractMemberText(text: string, name: string): string {
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
            name,
    );
    const range = member?.value.range;
    if (range === undefined) {
        throw new Error(`request body re-parse produced no ${name} member range`);
    }
    return text.slice(range[0], range[1]);
}
