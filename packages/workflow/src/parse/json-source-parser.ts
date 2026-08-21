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

/** A hard syntax error raised internally; `parse` converts it to a {@link JsonParseIssue}. */
class JsonSyntaxError extends Error {
  readonly location: SourceLocation;

  constructor(message: string, location: SourceLocation) {
    super(message);
    this.name = "JsonSyntaxError";
    this.location = location;
  }
}

function isSyntaxError(error: unknown): error is JsonSyntaxError {
  return error instanceof JsonSyntaxError;
}

/** Matches one JSON number at the parse position: no leading zeros, no bare `+`, no `NaN`. */
const NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/** Matches the four hexadecimal digits of a `\uXXXX` escape. */
const UNICODE_ESCAPE_PATTERN = /^[0-9a-fA-F]{4}/;

export class JsonSourceParser {
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
      const value = this.parseValue("");
      this.skipWhitespace();
      if (this.pos < this.text.length) this.fail("Unexpected content after the JSON document");
      if (this.duplicates.length > 0) return { ok: false, issues: this.duplicates };
      return { ok: true, value, sourceMap: Object.fromEntries(this.pointers) };
    } catch (error) {
      if (!isSyntaxError(error)) throw error;
      return {
        ok: false,
        issues: [
          {
            code: "workflow.parse.json-invalid",
            message: error.message,
            path: "",
            line: error.location.line,
            column: error.location.column,
          },
        ],
      };
    }
  }

  /** Decodes byte input as UTF-8; returns false when the bytes are not valid UTF-8. */
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

  private parseValue(pointer: string): unknown {
    this.skipWhitespace();
    const ch = this.text[this.pos];
    if (ch === undefined) this.fail("Unexpected end of input");
    const start = this.pos;
    let value: unknown;
    if (ch === "{") value = this.parseObjectBody(pointer);
    else if (ch === "[") value = this.parseArrayBody(pointer);
    else if (ch === '"') value = this.parseString();
    else if (ch === "-" || (ch >= "0" && ch <= "9")) value = this.parseNumber();
    else if (ch === "t") value = this.parseLiteral("true", true);
    else if (ch === "f") value = this.parseLiteral("false", false);
    else if (ch === "n") value = this.parseLiteral("null", null);
    else this.fail(`Unexpected character '${ch}'`);
    this.pointers.set(pointer, {
      value: this.locationAt(start),
      valueEnd: this.locationAt(this.pos),
    });
    return value;
  }

  private parseObjectBody(pointer: string): Record<string, unknown> {
    this.expect("{");
    const object: Record<string, unknown> = {};
    const firstKeyPositions = new Map<string, number>();
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos++;
      return object;
    }
    for (;;) {
      this.skipWhitespace();
      const keyPosition = this.pos;
      const key = this.parseString();
      this.skipWhitespace();
      this.expect(":");
      this.skipWhitespace();
      const memberPointer = `${pointer}/${escapePointerToken(key)}`;
      const firstPosition = firstKeyPositions.get(key);
      if (firstPosition !== undefined) {
        const first = this.locationAt(firstPosition);
        const location = this.locationAt(keyPosition);
        this.duplicates.push({
          code: "workflow.parse.duplicate-key",
          message: `Duplicate object key "${key}"`,
          path: memberPointer,
          line: location.line,
          column: location.column,
          details: { key, firstOccurrence: first },
        });
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

  private parseArrayBody(pointer: string): unknown[] {
    this.expect("[");
    const array: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === "]") {
      this.pos++;
      return array;
    }
    for (;;) {
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

  private parseString(): string {
    this.expect('"');
    let out = "";
    for (;;) {
      const ch = this.text[this.pos];
      if (ch === undefined) this.fail("Unterminated string");
      if (ch === '"') {
        this.pos++;
        return out;
      }
      if (ch === "\\") {
        out += this.parseEscape();
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) this.fail("Unescaped control character in string");
      out += ch;
      this.pos++;
    }
  }

  /** Parses one escape sequence; the parse position sits on the backslash. */
  private parseEscape(): string {
    this.pos++;
    const esc = this.text[this.pos];
    if (esc === undefined) this.fail("Unterminated string");
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

  /** Parses `\uXXXX`, combining a following low-surrogate escape into one code point. */
  private parseUnicodeEscape(): string {
    const hex = this.text.slice(this.pos, this.pos + 4);
    if (!UNICODE_ESCAPE_PATTERN.test(hex)) this.fail("Invalid \\u escape sequence");
    this.pos += 4;
    const code = Number.parseInt(hex, 16);
    if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      this.text[this.pos] === "\\" &&
      this.text[this.pos + 1] === "u"
    ) {
      const lowHex = this.text.slice(this.pos + 2, this.pos + 6);
      if (UNICODE_ESCAPE_PATTERN.test(lowHex)) {
        const low = Number.parseInt(lowHex, 16);
        if (low >= 0xdc00 && low <= 0xdfff) {
          this.pos += 6;
          return String.fromCharCode(code, low);
        }
      }
    }
    return String.fromCharCode(code);
  }

  private parseNumber(): number {
    NUMBER_PATTERN.lastIndex = this.pos;
    const match = NUMBER_PATTERN.exec(this.text);
    if (!match || match[0] === undefined) this.fail("Invalid number");
    this.pos = NUMBER_PATTERN.lastIndex;
    return Number(match[0]);
  }

  private parseLiteral(word: string, value: unknown): unknown {
    if (!this.text.startsWith(word, this.pos)) this.fail(`Invalid literal; expected '${word}'`);
    this.pos += word.length;
    return value;
  }

  // -------------------------------------------------------------------------
  // Positions
  // -------------------------------------------------------------------------

  private skipWhitespace(): void {
    for (;;) {
      const ch = this.text[this.pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") this.pos++;
      else return;
    }
  }

  private expect(expected: string): void {
    if (this.text[this.pos] !== expected) this.fail(`Expected '${expected}'`);
    this.pos++;
  }

  /** Raises a syntax error at the current position; `parse` converts it to an issue. */
  private fail(message: string): never {
    throw new JsonSyntaxError(message, this.locationAt(this.pos));
  }

  /** Converts a text offset to a one-based line and column. */
  private locationAt(position: number): SourceLocation {
    const starts = this.lineStarts ?? this.computeLineStarts();
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      const midStart = starts[mid];
      if (midStart === undefined || midStart > position) high = mid - 1;
      else low = mid;
    }
    const lineStart = starts[low] ?? 0;
    return { line: low + 1, column: position - lineStart + 1 };
  }

  private computeLineStarts(): number[] {
    const starts = [0];
    for (let i = 0; i < this.text.length; i++) {
      if (this.text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    this.lineStarts = starts;
    return starts;
  }
}
