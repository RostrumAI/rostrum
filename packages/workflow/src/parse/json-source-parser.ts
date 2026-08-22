import { type AnyNode, type MemberNode, parse as parseJsonAst } from "@humanwhocodes/momoa";
import {
    escapePointerToken,
    type SourceLocation,
    type SourceMap,
    type SourcePointer,
} from "../source-map";

/**
 * Strict JSON parsing with a source map.
 *
 * Stage 0 of the validation pipeline parses raw input under the v1 rules
 * (E1-S2, E1-S3): duplicate keys are errors rather than last-wins, raw
 * control characters in strings are rejected, the `NaN`/`Infinity`
 * literals accepted by `JSON.parse` are rejected because they are not
 * part of the JSON grammar (momoa implements ECMA-404), and byte input
 * must be valid UTF-8. The parser records the location of every value so
 * findings can carry one-based line and column numbers.
 */

export type ParseErrorCode =
    | "workflow.parse.json-invalid"
    | "workflow.parse.duplicate-key"
    | "workflow.parse.invalid-utf8";

/** One parse problem: a syntax error, a duplicate key, or an encoding failure. */
export interface JsonParseIssue {
    /** Stable finding code for the problem. */
    code: ParseErrorCode;
    /** Human-readable explanation, including the offending text where relevant. */
    message: string;
    /** JSON Pointer of the offending member, or `""` when there is none. */
    path: string;
    /** One-based line of the offending character, when known. */
    line?: number;
    /** One-based column of the offending character, when known. */
    column?: number;
    /** Structured context, for example the duplicated key and its first occurrence. */
    details?: Record<string, unknown>;
}

export type JsonParseResult =
    | { ok: true; value: unknown; sourceMap: SourceMap }
    | { ok: false; issues: JsonParseIssue[] };

/** JSON Pointer (RFC 6901) of the document root. */
const ROOT_POINTER = "";

/**
 * Turns raw input into a validated value plus the source locations every
 * finding can point at. Grammar handling is delegated to momoa; this
 * class owns the workflow-specific rules: duplicate-key rejection,
 * control-character rejection, pointer construction, and UTF-8
 * validation of byte input.
 */
export class JsonSourceParser {
    private readonly input: string | Uint8Array;
    private text = "";
    private lineStarts: number[] | null = null;
    private readonly pointers = new Map<string, SourcePointer>();
    private readonly issues: JsonParseIssue[] = [];

    /** Constructs a parser over raw text or UTF-8 bytes; decoding happens in `parse`. */
    constructor(input: string | Uint8Array) {
        this.input = input;
    }

    /** Parses the input and returns the value with its source map, or the collected issues. */
    parse(): JsonParseResult {
        if (!this.decode()) {
            return {
                ok: false,
                issues: [
                    {
                        code: "workflow.parse.invalid-utf8",
                        message: "Input is not valid UTF-8",
                        path: "",
                    },
                ],
            };
        }

        let document: ReturnType<typeof parseJsonAst>;
        try {
            document = parseJsonAst(this.text, { mode: "json" });
        } catch (error) {
            return { ok: false, issues: [this.syntaxIssue(error)] };
        }

        // The whole document is one value, recorded under the root pointer.
        const value = this.appendValue(document.body, ROOT_POINTER);
        if (this.issues.length > 0) {
            return { ok: false, issues: this.issues };
        }
        return { ok: true, value, sourceMap: Object.fromEntries(this.pointers) };
    }

    /**
     * Decodes byte input as UTF-8 and returns true on success. `fatal`
     * makes the decoder reject invalid byte sequences instead of
     * substituting replacement characters. Text input is already decoded.
     */
    private decode(): boolean {
        if (typeof this.input === "string") {
            this.text = this.input;
            return true;
        }
        try {
            this.text = new TextDecoder("utf-8", { fatal: true }).decode(this.input);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Walks one AST node, recording its source locations under `pointer`
     * and returning the plain JSON value the node represents. Objects and
     * arrays recurse so every nested value lands in the pointer map.
     */
    private appendValue(node: AnyNode, pointer: string): unknown {
        this.pointers.set(pointer, {
            value: this.toLocation(node.loc.start),
            valueEnd: this.toLocation(node.loc.end),
        });
        switch (node.type) {
            case "Object":
                return this.appendObject(node, pointer);
            case "Array":
                return node.elements.map((element, index) =>
                    this.appendValue(element.value, `${pointer}/${index}`),
                );
            case "Document":
                return this.appendValue(node.body, pointer);
            case "String":
                this.rejectControlCharacters(node.value, pointer, node.loc.start);
                return node.value;
            case "Number":
            case "Boolean":
                return node.value;
            case "Null":
                return null;
            default:
                throw new Error(`Unexpected AST node '${node.type}' at ${pointer}`);
        }
    }

    /**
     * Walks an object's members after the `{`. Keys are compared after
     * escape decoding — `"a"` and `"\u0061"` are the same member name — and
     * each repetition after the first is reported at its own location.
     */
    private appendObject(
        node: Extract<AnyNode, { type: "Object" }>,
        pointer: string,
    ): Record<string, unknown> {
        const object: Record<string, unknown> = {};
        const firstKeyLocations = new Map<string, SourceLocation>();
        for (const member of node.members) {
            // Member names are strings in json mode; IdentifierNode only
            // occurs in json5 mode, but the union forces the guard.
            const key = member.name.type === "String" ? member.name.value : member.name.name;
            const memberPointer = `${pointer}/${escapePointerToken(key)}`;
            const firstLocation = firstKeyLocations.get(key);
            if (firstLocation === undefined) {
                firstKeyLocations.set(key, this.toLocation(member.name.loc.start));
            } else {
                this.recordDuplicateKey(member, key, firstLocation, memberPointer);
            }
            object[key] = this.appendValue(member.value, memberPointer);
        }
        return object;
    }

    /**
     * Reports raw control characters (U+0000–U+001F) inside one string
     * value; momoa's tokenizer accepts them, the JSON grammar does not.
     */
    private rejectControlCharacters(
        value: string,
        pointer: string,
        start: { line: number; column: number },
    ): void {
        for (const ch of value) {
            if (ch.charCodeAt(0) >= 0x20) {
                continue;
            }
            this.issues.push({
                code: "workflow.parse.json-invalid",
                message: "Unescaped control character in string",
                path: pointer,
                ...this.toLocation(start),
            });
            return;
        }
    }

    /** Records a duplicated object key at its repeating occurrence. */
    private recordDuplicateKey(
        member: MemberNode,
        key: string,
        firstLocation: SourceLocation,
        memberPointer: string,
    ): void {
        this.issues.push({
            code: "workflow.parse.duplicate-key",
            message: `Duplicate object key "${key}"`,
            path: memberPointer,
            ...this.toLocation(member.name.loc.start),
            details: { key, firstOccurrence: firstLocation },
        });
    }

    /** Converts a syntax failure into an issue located at the offending offset. */
    private syntaxIssue(error: unknown): JsonParseIssue {
        const offset =
            typeof error === "object" && error !== null && "offset" in error
                ? Number(error.offset)
                : NaN;
        const issue: JsonParseIssue = {
            code: "workflow.parse.json-invalid",
            message: error instanceof Error ? error.message : String(error),
            path: "",
        };
        if (!Number.isNaN(offset)) {
            const location = this.locationAt(offset);
            issue.line = location.line;
            issue.column = location.column;
        }
        return issue;
    }

    /**
     * Converts a text offset to a one-based line and column by binary
     * search over the line-start index: the greatest start at or before
     * the position is its line's first character.
     */
    private locationAt(position: number): SourceLocation {
        const starts = this.lineStarts ?? this.computeLineStarts();
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            const midStart = starts[mid];
            if (midStart === undefined || midStart > position) {
                high = mid - 1;
            } else {
                low = mid;
            }
        }
        const lineStart = starts[low] ?? 0;
        return { line: low + 1, column: position - lineStart + 1 };
    }

    /** Indexes the offset of each line's first character, caching the result. */
    private computeLineStarts(): number[] {
        const starts = [0];
        for (let i = 0; i < this.text.length; i++) {
            if (this.text.charCodeAt(i) === 10) {
                starts.push(i + 1);
            }
        }
        this.lineStarts = starts;
        return starts;
    }

    /** Drops the offset from a momoa location, keeping the one-based line and column. */
    private toLocation(location: { line: number; column: number }): SourceLocation {
        return { line: location.line, column: location.column };
    }
}
