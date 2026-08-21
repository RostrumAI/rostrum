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
 * (E1-S2, E1-S3): duplicate keys are errors rather than last-wins, the
 * `NaN`/`Infinity` literals accepted by `JSON.parse` are rejected because
 * they are not part of the JSON grammar, and byte input must be valid
 * UTF-8. The parser records the location of every value so findings can
 * carry one-based line and column numbers.
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

/**
 * Aborts recursive-descent parsing at the first syntax error.
 *
 * The error carries the finished issue rather than raw parts, so `parse`
 * reports it unchanged instead of converting representations.
 */
class JsonParseError extends Error {
  readonly issue: JsonParseIssue;

  /** Builds the abort signal from the issue it carries. */
  constructor(issue: JsonParseIssue) {
    super(issue.message);
    this.name = "JsonParseError";
    this.issue = issue;
  }
}

/** Checks whether a thrown value is a parse abort rather than an unexpected failure. */
function isParseAbort(error: unknown): error is JsonParseError {
  return error instanceof JsonParseError;
}

export class JsonSourceParser {
  /**
   * Matches one JSON number at the parse position: no leading zeros, no
   * bare `+`, no `NaN`. Kept sticky so it matches at `lastIndex`.
   */
  private static readonly NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

  /** Matches the four hexadecimal digits of a `\uXXXX` escape. */
  private static readonly UNICODE_ESCAPE_PATTERN = /^[0-9a-fA-F]{4}/;

  /** JSON Pointer (RFC 6901) of the document root. */
  private static readonly ROOT_POINTER = "";

  private readonly input: string | Uint8Array;
  private text = "";
  private pos = 0;
  private lineStarts: number[] | null = null;
  private readonly pointers = new Map<string, SourcePointer>();
  private readonly duplicates: JsonParseIssue[] = [];

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

    try {
      // The whole document is one value, recorded under the root pointer.
      const value = this.parseValue(JsonSourceParser.ROOT_POINTER);
      this.skipWhitespace();
      if (this.pos < this.text.length) {
        this.fail("Unexpected content after the JSON document");
      }
      if (this.duplicates.length > 0) {
        return { ok: false, issues: this.duplicates };
      }
      return { ok: true, value, sourceMap: Object.fromEntries(this.pointers) };
    } catch (error) {
      if (!isParseAbort(error)) {
        throw error;
      }
      return { ok: false, issues: [error.issue] };
    }
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

  // -------------------------------------------------------------------------
  // Values
  // -------------------------------------------------------------------------

  /**
   * Parses one value and records its source locations under `pointer`.
   * Dispatches on the first character, which identifies the value kind.
   */
  private parseValue(pointer: string): unknown {
    this.skipWhitespace();
    const ch = this.text[this.pos];
    if (ch === undefined) {
      this.fail("Unexpected end of input");
    }
    const start = this.pos;
    let value: unknown;
    switch (ch) {
      case "{":
        value = this.parseObjectBody(pointer);
        break;
      case "[":
        value = this.parseArrayBody(pointer);
        break;
      case '"':
        value = this.parseString();
        break;
      case "-":
      case "0":
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        value = this.parseNumber();
        break;
      case "t":
        value = this.parseLiteral("true", true);
        break;
      case "f":
        value = this.parseLiteral("false", false);
        break;
      case "n":
        value = this.parseLiteral("null", null);
        break;
      default:
        this.fail(`Unexpected character '${ch}'`);
    }
    this.pointers.set(pointer, {
      value: this.locationAt(start),
      valueEnd: this.locationAt(this.pos),
    });
    return value;
  }

  /** Parses an object body after `{`; members extend the parent pointer by escaped key. */
  private parseObjectBody(pointer: string): Record<string, unknown> {
    this.expect("{");
    const object: Record<string, unknown> = {};
    const firstKeyPositions = new Map<string, number>();
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos++;
      return object;
    }
    while (true) {
      this.skipWhitespace();
      const keyPosition = this.pos;
      const key = this.parseString();
      this.skipWhitespace();
      this.expect(":");
      this.skipWhitespace();
      const memberPointer = `${pointer}/${escapePointerToken(key)}`;
      const firstPosition = firstKeyPositions.get(key);
      if (firstPosition !== undefined) {
        this.recordDuplicateKey(key, keyPosition, firstPosition, memberPointer);
      } else {
        firstKeyPositions.set(key, keyPosition);
      }
      object[key] = this.parseValue(memberPointer);
      this.skipWhitespace();
      if (this.text[this.pos] === ",") {
        this.pos++;
        continue;
      }
      if (this.text[this.pos] === "}") {
        this.pos++;
        return object;
      }
      this.fail("Expected ',' or '}' in object");
    }
  }

  /** Parses an array body after `[`; elements extend the parent pointer by index. */
  private parseArrayBody(pointer: string): unknown[] {
    this.expect("[");
    const array: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === "]") {
      this.pos++;
      return array;
    }
    while (true) {
      array.push(this.parseValue(`${pointer}/${array.length}`));
      this.skipWhitespace();
      if (this.text[this.pos] === ",") {
        this.pos++;
        continue;
      }
      if (this.text[this.pos] === "]") {
        this.pos++;
        return array;
      }
      this.fail("Expected ',' or ']' in array");
    }
  }

  /** Parses a string value after the opening quote, decoding escapes as it goes. */
  private parseString(): string {
    this.expect('"');
    let out = "";
    while (true) {
      const ch = this.text[this.pos];
      if (ch === undefined) {
        this.fail("Unterminated string");
      }
      if (ch === '"') {
        this.pos++;
        return out;
      }
      if (ch === "\\") {
        out += this.parseEscape();
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) {
        this.fail("Unescaped control character in string");
      }
      out += ch;
      this.pos++;
    }
  }

  /**
   * Parses one escape sequence with the parse position on the backslash,
   * returning the decoded character.
   */
  private parseEscape(): string {
    this.pos++;
    const esc = this.text[this.pos];
    if (esc === undefined) {
      this.fail("Unterminated string");
    }
    this.pos++;
    switch (esc) {
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "/":
        return "/";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u":
        return this.parseUnicodeEscape();
      default:
        this.fail(`Invalid escape sequence '\\${esc}'`);
    }
  }

  /**
   * Parses `\uXXXX` after the `u`. A high surrogate followed by a low
   * surrogate escape combines into one code point; a lone surrogate is
   * kept as-is because the JSON grammar permits it.
   */
  private parseUnicodeEscape(): string {
    const hex = this.text.slice(this.pos, this.pos + 4);
    if (!JsonSourceParser.UNICODE_ESCAPE_PATTERN.test(hex)) {
      this.fail("Invalid \\u escape sequence");
    }
    this.pos += 4;
    const code = Number.parseInt(hex, 16);
    const nextIsLowSurrogate =
      code >= 0xd800 &&
      code <= 0xdbff &&
      this.text[this.pos] === "\\" &&
      this.text[this.pos + 1] === "u";
    if (nextIsLowSurrogate) {
      const lowHex = this.text.slice(this.pos + 2, this.pos + 6);
      if (JsonSourceParser.UNICODE_ESCAPE_PATTERN.test(lowHex)) {
        const low = Number.parseInt(lowHex, 16);
        if (low >= 0xdc00 && low <= 0xdfff) {
          this.pos += 6;
          return String.fromCharCode(code, low);
        }
      }
    }
    return String.fromCharCode(code);
  }

  /** Parses a number at the parse position per the JSON number grammar. */
  private parseNumber(): number {
    const pattern = JsonSourceParser.NUMBER_PATTERN;
    pattern.lastIndex = this.pos;
    const match = pattern.exec(this.text);
    if (!match || match[0] === undefined) {
      this.fail("Invalid number");
    }
    this.pos = pattern.lastIndex;
    return Number(match[0]);
  }

  /** Parses a literal word (`true`, `false`, `null`) at the parse position. */
  private parseLiteral(word: string, value: unknown): unknown {
    if (!this.text.startsWith(word, this.pos)) {
      this.fail(`Invalid literal; expected '${word}'`);
    }
    this.pos += word.length;
    return value;
  }

  /** Records a duplicated object key at its second occurrence. */
  private recordDuplicateKey(
    key: string,
    keyPosition: number,
    firstPosition: number,
    memberPointer: string,
  ): void {
    const location = this.locationAt(keyPosition);
    this.duplicates.push({
      code: "workflow.parse.duplicate-key",
      message: `Duplicate object key "${key}"`,
      path: memberPointer,
      line: location.line,
      column: location.column,
      details: { key, firstOccurrence: this.locationAt(firstPosition) },
    });
  }

  // -------------------------------------------------------------------------
  // Positions
  // -------------------------------------------------------------------------

  /** Advances past whitespace: space, tab, newline, and carriage return. */
  private skipWhitespace(): void {
    while (true) {
      const ch = this.text[this.pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.pos++;
        continue;
      }
      return;
    }
  }

  /** Consumes the expected character or raises a syntax error. */
  private expect(expected: string): void {
    if (this.text[this.pos] !== expected) {
      this.fail(`Expected '${expected}'`);
    }
    this.pos++;
  }

  /** Raises a syntax error at the current position; `parse` converts it to an issue. */
  private fail(message: string): never {
    throw new JsonParseError({
      code: "workflow.parse.json-invalid",
      message,
      path: "",
      ...this.locationAt(this.pos),
    });
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
}
