/**
 * Source locations for JSON documents.
 *
 * Validation stage 0 builds a source map while parsing, and findings attach
 * the location of their JSON Pointer when the map is available. Lines and
 * columns are one-based, matching the finding contract in E1-S2.
 */

/** A one-based position in the source text. */
export interface SourceLocation {
    /** One-based line number. */
    line: number;
    /** One-based column number. */
    column: number;
}

/** The start and end locations of one JSON value in the source text. */
export interface SourcePointer {
    /** Location of the first character of the value. */
    value: SourceLocation;
    /** Location just past the last character of the value. */
    valueEnd: SourceLocation;
}

/** Maps each JSON Pointer (RFC 6901) in a document to its source locations. */
export type SourceMap = Record<string, SourcePointer>;

/** Escapes one JSON Pointer reference token: `~` becomes `~0` and `/` becomes `~1`. */
export function escapePointerToken(token: string): string {
    return token.replaceAll("~", "~0").replaceAll("/", "~1");
}
