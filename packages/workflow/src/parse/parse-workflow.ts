import type { Finding } from "../findings";
import { type JsonParseIssue, JsonSourceParser } from "./json-source-parser";

/** The result of strictly parsing raw workflow input. */
export type ParsedWorkflow =
    | { ok: false; findings: Finding[] }
    | { ok: true; text: string; document: unknown };

/**
 * Strictly parses raw workflow JSON given as UTF-8 bytes or text. The
 * failure branch carries the parse issues as findings with their source
 * locations; the success branch carries the decoded text and the parsed
 * value. The text is the input's exact text, never a re-serialization, so
 * callers can store it and keep findings anchored to it.
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
