/**
 * Source-region scanning for the deterministic rule pass.
 *
 * @remarks
 * A pattern check must run against the right region of a line, which is not the
 * whole line. Without this, a banned identifier inside a string literal, a
 * regular expression that names banned identifiers, or a patch embedded in a
 * test's template literal all read as violations — which is what happened when
 * this corpus first reviewed its own rule files.
 *
 * A line has two regions that checks care about, and they are opposites:
 *
 * - **code** — everything outside comments. Identifiers, syntax, and types.
 * - **comments** — the comment text alone. A directive like `@ts-expect-error`
 *   or a marker like `TODO:` is only meaningful inside a comment, so a check for
 *   one must read this region; blanking comments before matching would make
 *   those checks unable to fire at all.
 *
 * Both projections have the same length as the input line, with the other region
 * blanked, so a match offset still points at the right column.
 *
 * Template and string literals belong to neither: their contents are not code
 * and not comments, so a token inside one is a value, not a use.
 *
 * Prose is scanned separately. It needs only its inline code spans and quoted
 * terms blanked, because an apostrophe in `the repository's rule` would
 * otherwise open a phantom string and blank the rest of the line.
 */

/** Characters after which a `/` begins a regular expression rather than a division. */
const REGEX_PREFIXES = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", ">"]);

/** Carry-over state between the lines of one file. */
export interface ScanState {
    /** True while inside a block comment that has not closed. */
    inBlockComment: boolean;
    /** True while inside a template literal that has not closed. */
    inTemplate: boolean;
}

/** The two regions of a source line, each with the other region blanked. */
export interface LineRegions {
    /** The line with comment contents blanked. */
    code: string;
    /** The line with everything but comment contents blanked. */
    comments: string;
}

/**
 * Builds an empty scan state for the start of a file.
 *
 * @returns A state with nothing open.
 */
export function newScanState(): ScanState {
    return { inBlockComment: false, inTemplate: false };
}

/**
 * Splits a sequence of source lines into code and comment regions.
 *
 * State carries across lines so a block comment or template literal opened on
 * one line keeps its region assignment on the following lines. Call this per
 * file, or per hunk, with the lines in source order.
 *
 * @param lines - Source lines in order.
 * @returns One entry per line, in the same order.
 */
export function scanSourceLines(lines: string[]): LineRegions[] {
    const state = newScanState();
    return lines.map((line) => scanSourceLine(line, state));
}

/**
 * Splits one source line into code and comment regions, updating carry-over state.
 *
 * @param line - A single line of source.
 * @param state - State carried from the preceding line, updated in place.
 * @returns The line's two regions, each blanked in the region it does not cover.
 */
export function scanSourceLine(line: string, state: ScanState): LineRegions {
    // Indexed in UTF-16 units, not code points, because the scanner's indices and
    // the comment projection are both measured in those units: spreading the line
    // into code points would make an astral character shift every later range.
    const code = line.split("");
    // The comment projection starts empty and receives only comment text, so a
    // check that reads it cannot match an identifier or a literal.
    const comments = Array.from<string>({ length: line.length }).fill(" ");

    /** Blanks a range of the code projection. */
    const blankCode = (from: number, to: number): void => {
        for (let cursor = from; cursor <= to && cursor < code.length; cursor += 1) {
            code[cursor] = " ";
        }
    };

    /** Copies a range of the line into the comment projection. */
    const keepAsComment = (from: number, to: number): void => {
        for (let cursor = from; cursor <= to && cursor < comments.length; cursor += 1) {
            comments[cursor] = line[cursor] ?? " ";
        }
    };

    let index = 0;
    let lastSignificant = "";

    while (index < line.length) {
        const character = line[index] ?? "";
        const next = line[index + 1] ?? "";

        if (state.inBlockComment) {
            const close = line.indexOf("*/", index);
            const end = close === -1 ? line.length - 1 : close + 1;
            blankCode(index, end);
            keepAsComment(index, end);
            index = end + 1;
            if (close !== -1) {
                state.inBlockComment = false;
            }
            continue;
        }

        if (state.inTemplate) {
            // A backtick closes the literal, and it is the first character the
            // continuation looks for rather than the second.
            const close = findTemplateEnd(line, index);
            blankCode(index, Math.min(close, line.length - 1));
            if (close >= line.length) {
                return { code: code.join(""), comments: comments.join("") };
            }
            state.inTemplate = false;
            index = close + 1;
            lastSignificant = "`";
            continue;
        }

        if (character === "/" && next === "/") {
            blankCode(index, line.length - 1);
            keepAsComment(index, line.length - 1);
            break;
        }
        if (character === "/" && next === "*") {
            state.inBlockComment = true;
            blankCode(index, index + 1);
            keepAsComment(index, index + 1);
            index += 2;
            continue;
        }
        if (character === '"' || character === "'") {
            const close = findStringEnd(line, index, character);
            const end = close === -1 ? line.length - 1 : close;
            blankCode(index, end);
            if (close === -1) {
                return { code: code.join(""), comments: comments.join("") };
            }
            index = close + 1;
            lastSignificant = character;
            continue;
        }
        if (character === "`") {
            const close = findTemplateEnd(line, index + 1);
            blankCode(index, Math.min(close, line.length - 1));
            if (close >= line.length) {
                state.inTemplate = true;
                return { code: code.join(""), comments: comments.join("") };
            }
            index = close + 1;
            lastSignificant = "`";
            continue;
        }
        if (character === "/" && (lastSignificant === "" || REGEX_PREFIXES.has(lastSignificant))) {
            const close = findRegexEnd(line, index);
            if (close !== -1) {
                blankCode(index, close);
                index = close + 1;
                lastSignificant = "/";
                continue;
            }
            // No closing slash: this was division after all; leave the line as written.
        }
        if (character.trim().length > 0) {
            lastSignificant = character;
        }
        index += 1;
    }
    return { code: code.join(""), comments: comments.join("") };
}

/**
 * Finds the closing backtick of a template literal on the same line.
 *
 * @param line - Line being scanned.
 * @param start - Index to begin scanning from: one past an opening backtick, or
 * the current index when continuing a literal opened on an earlier line.
 * @returns Index of the closing backtick, or the line length when it does not close.
 */
function findTemplateEnd(line: string, start: number): number {
    let cursor = start;
    while (cursor < line.length) {
        const character = line[cursor] ?? "";
        if (character === "\\") {
            cursor += 2;
            continue;
        }
        if (character === "`") {
            return cursor;
        }
        cursor += 1;
    }
    return line.length;
}

/**
 * Finds the closing delimiter of a quoted string on the same line.
 *
 * @param line - Line being scanned.
 * @param start - Index of the opening delimiter.
 * @param quote - The delimiter character.
 * @returns Index of the closing delimiter, or -1 when the string does not close.
 */
function findStringEnd(line: string, start: number, quote: string): number {
    let cursor = start + 1;
    while (cursor < line.length) {
        const character = line[cursor] ?? "";
        if (character === "\\") {
            cursor += 2;
            continue;
        }
        if (character === quote) {
            return cursor;
        }
        cursor += 1;
    }
    return -1;
}

/**
 * Finds the closing slash of a regular-expression literal, respecting classes.
 *
 * @param line - Line being scanned.
 * @param start - Index of the opening slash.
 * @returns Index of the closing slash, or -1 when no literal closes.
 */
function findRegexEnd(line: string, start: number): number {
    let cursor = start + 1;
    let inClass = false;
    while (cursor < line.length) {
        const character = line[cursor] ?? "";
        if (character === "\\") {
            cursor += 2;
            continue;
        }
        if (character === "[") {
            inClass = true;
        } else if (character === "]") {
            inClass = false;
        } else if (character === "/" && !inClass) {
            return cursor;
        }
        cursor += 1;
    }
    return -1;
}

/**
 * Blanks the inline code spans and quoted terms of a prose line.
 *
 * A term inside backticks or quotation marks names a term; it does not use one.
 * Without this, a document that bans a word cannot state the word it bans, and
 * every rule that lists a rejected term reports itself. Only backticks, straight
 * double quotes, and their curly equivalents delimit a mention: an apostrophe is
 * ordinary prose punctuation, and treating it as a delimiter would blank most of
 * a sentence.
 *
 * @param line - A line of markdown or other prose.
 * @returns The line with the contents of code spans and quoted terms blanked.
 */
export function blankInlineCode(line: string): string {
    const output = line.split("");
    const delimiters = ["`", '"', "\u201C", "\u201D"];
    let index = 0;
    while (index < line.length) {
        const opening = line[index] ?? "";
        if (!delimiters.includes(opening)) {
            index += 1;
            continue;
        }
        const closer = opening === "\u201C" ? "\u201D" : opening;
        const close = line.indexOf(closer, index + 1);
        if (close === -1) {
            index += 1;
            continue;
        }
        for (let cursor = index + 1; cursor < close; cursor += 1) {
            output[cursor] = " ";
        }
        index = close + 1;
    }
    return output.join("");
}
