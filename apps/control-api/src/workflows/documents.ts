import { type DocumentNode, parse as parseJsonAst } from "@humanwhocodes/momoa";
import { type Finding, type JsonParseIssue, JsonSourceParser } from "@rostrum/workflow";

/**
 * Document handling for the workflow operations: strict parsing with the
 * shared library's parser, and the surgical `id` injection the draft
 * lifecycle requires.
 *
 * Document-carrying requests store the exact submitted bytes, so the
 * parsed document is never re-serialized. Identity is handled by splicing
 * the id token in place: draft creation replaces any `id` the author
 * supplied with the server-minted one (E1-S3: an id in the creation
 * payload is replaced, never honored), and a save that omits the `id`
 * gets the addressed workflow's id inserted. A splice must preserve JSON
 * validity, so every splice re-parses strictly; a failure is a bug and
 * surfaces as 500 `internal_error`, never as stored corrupt text.
 */

/** The result of strictly parsing raw workflow input. */
export type ParsedWorkflow =
    | { ok: false; findings: Finding[] }
    | { ok: true; text: string; document: unknown };

/**
 * Strictly parses raw workflow JSON given as UTF-8 bytes or text.
 * Parse failures — invalid JSON, duplicate keys, `NaN`/`Infinity`,
 * invalid UTF-8 — return their issues mapped to blocking findings;
 * the failure is a 400, never a draft.
 */
export function parseWorkflow(input: string | Uint8Array): ParsedWorkflow {
    let text: string;
    if (typeof input === "string") {
        text = input;
    } else {
        try {
            // Same decoder options as the library parser, so the text
            // parsed here and the text validated and stored are identical.
            text = new TextDecoder("utf-8", { fatal: true }).decode(input);
        } catch {
            return {
                ok: false,
                findings: [
                    {
                        code: "workflow.parse.invalid-utf8",
                        message: "Input is not valid UTF-8",
                        blocking: true,
                        path: "",
                    },
                ],
            };
        }
    }
    const parsed = new JsonSourceParser(text).parse();
    if (!parsed.ok) {
        return { ok: false, findings: parsed.issues.map(parseIssueToFinding) };
    }
    return { ok: true, text, document: parsed.value };
}

/** Maps one strict-parse issue to a finding, preserving location and details. */
function parseIssueToFinding(issue: JsonParseIssue): Finding {
    return {
        code: issue.code,
        message: issue.message,
        blocking: true,
        path: issue.path,
        ...(issue.line === undefined ? {} : { line: issue.line }),
        ...(issue.column === undefined ? {} : { column: issue.column }),
        ...(issue.details === undefined ? {} : { details: issue.details }),
    };
}

/** Checks whether a parsed document is a JSON object (the injectable root shape). */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Where the root object's `id` member lives in the source text, located by
 * re-parsing with momoa's byte offsets: the workflow library's source map
 * carries only line and column, which cannot splice safely across line
 * endings.
 */
type RootIdLocation =
    | { kind: "member"; valueStart: number; valueEnd: number }
    | { kind: "object"; braceOffset: number; hasMembers: boolean }
    | { kind: "other" };

/** Locates the id injection point in strictly-valid JSON text. */
function locateRootId(text: string): RootIdLocation {
    let document: DocumentNode;
    try {
        document = parseJsonAst(text, { mode: "json", ranges: true });
    } catch (error) {
        // The caller parsed this text strictly already; a failure here is
        // an invariant violation, not client input.
        throw new Error(`workflow document re-parse failed: ${(error as Error).message}`);
    }
    const root = document.body;
    if (root.type !== "Object") return { kind: "other" };
    const idMember = root.members.find(
        (member) => (member.name.type === "String" ? member.name.value : member.name.name) === "id",
    );
    if (idMember !== undefined) {
        const range = idMember.value.range;
        if (range === undefined) {
            throw new Error("workflow document re-parse produced no id member range");
        }
        return { kind: "member", valueStart: range[0], valueEnd: range[1] };
    }
    const braceOffset = root.range?.[0];
    if (braceOffset === undefined) {
        throw new Error("workflow document re-parse produced no root object range");
    }
    return { kind: "object", braceOffset, hasMembers: root.members.length > 0 };
}

/** Re-parses spliced text strictly; a failure means the splice was wrong. */
function assertStillValid(text: string): void {
    const result = new JsonSourceParser(text).parse();
    if (!result.ok) {
        throw new Error(
            `id injection produced invalid workflow JSON: ${result.issues[0]?.message ?? "unknown parse failure"}`,
        );
    }
}

/** Builds the id member to insert, with a comma only when members follow. */
function idMemberText(workflowId: string, hasMembers: boolean): string {
    const member = `"id":${JSON.stringify(workflowId)}`;
    return hasMembers ? `${member},` : member;
}

/**
 * Splices the minted workflow `id` into a draft's first revision: an
 * existing `id` member's value is replaced (whatever it held), and a
 * document without one gets the member inserted after the opening brace.
 * A root that is not an object returns the text unchanged; validation
 * reports the shape finding.
 */
export function replaceWorkflowId(text: string, workflowId: string): string {
    const location = locateRootId(text);
    let spliced: string;
    switch (location.kind) {
        case "member":
            spliced =
                text.slice(0, location.valueStart) +
                JSON.stringify(workflowId) +
                text.slice(location.valueEnd);
            break;
        case "object":
            spliced =
                text.slice(0, location.braceOffset + 1) +
                idMemberText(workflowId, location.hasMembers) +
                text.slice(location.braceOffset + 1);
            break;
        case "other":
            return text;
    }
    assertStillValid(spliced);
    return spliced;
}

/**
 * Splices the addressed workflow `id` into a saved revision that omits it,
 * after the opening brace. A document that already carries an `id` member
 * must never reach this function (the caller checks identity first); a
 * root that is not an object returns the text unchanged.
 */
export function insertWorkflowId(text: string, workflowId: string): string {
    const location = locateRootId(text);
    if (location.kind === "member") {
        throw new Error("id insertion reached a document that already carries an id member");
    }
    if (location.kind === "other") return text;
    const spliced =
        text.slice(0, location.braceOffset + 1) +
        idMemberText(workflowId, location.hasMembers) +
        text.slice(location.braceOffset + 1);
    assertStillValid(spliced);
    return spliced;
}
