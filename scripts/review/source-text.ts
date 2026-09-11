/**
 * Source-region scanning for the deterministic rule pass.
 *
 * @remarks
 * A pattern check must run against code, not against text that happens to
 * contain code. Without this, a banned identifier inside a string literal, a
 * regular expression that names banned identifiers, or a patch embedded in a
 * test's template literal all read as violations — which is exactly what
 * happened when the corpus first reviewed its own rule files.
 *
 * Blanking replaces a region's contents with spaces of the same length, so the
 * result is the same length as the input and any match offset still points at
 * the right column.
 *
 * Two shapes are handled because the two file kinds fail differently. Source
 * needs full lexical blanking, including multi-line template literals and block
 * comments, because a test embeds a patch verbatim. Prose needs only its inline
 * code spans blanked: an apostrophe in `the repository's rule` would otherwise
 * open a phantom string and blank the rest of the line, hiding real findings.
 */

/** Characters after which a `/` begins a regular expression rather than a division. */
const REGEX_PREFIXES = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", ">"]);

/** Carry-over state between the lines of one file. */
interface ScanState {
    /** True while inside a block comment that has not closed. */
    inBlockComment: boolean;
    /** True while inside a template literal that has not closed. */
    inTemplate: boolean;
}

/**
 * Blanks the non-code regions of a sequence of source lines.
 *
 * State is carried across lines so a template literal or block comment opened on
 * one line keeps its contents blanked on the following lines. Call this per file
 * (or per hunk) with the lines in source order.
 *
 * @param lines - Source lines in order.
 * @returns The lines with non-code regions blanked, in the same order.
 */
export function blankSourceLines(lines: string[]): string[] {
    const state: ScanState = { inBlockComment: false, inTemplate: false };
    return lines.map((line) => blankSourceLine(line, state));
}

/**
 * Blanks the non-code regions of one source line, updating carry-over state.
 *
 * @param line - A single line of source.
 * @param state - State carried from the preceding line, updated in place.
 * @returns The line with non-code regions blanked.
 */
export function blankSourceLine(line: string, state: ScanState): string {
    const output = [...line];
    let index = 0;
    let lastSignificant = "";
    const blank = (from: number, to: number): void => {
        for (let cursor = from; cursor <= to && cursor < output.length; cursor += 1) {
            output[cursor] = " ";
        }
    };

    while (index < line.length) {
        const character = line[index] ?? "";
        const next = line[index + 1] ?? "";

        if (state.inBlockComment) {
            const close = line.indexOf("*/", index);
            if (close === -1) {
                blank(index, line.length - 1);
                return output.join("");
            }
            blank(index, close + 1);
            index = close + 2;
            state.inBlockComment = false;
            continue;
        }

        if (state.inTemplate) {
            let cursor = index;
            while (cursor < line.length) {
                const inner = line[cursor] ?? "";
                if (inner === "\\") {
                    cursor += 2;
                    continue;
                }
                if (inner === "`") {
                    break;
                }
                cursor += 1;
            }
            blank(index, Math.min(cursor, line.length - 1));
            if (cursor >= line.length) {
                return output.join("");
            }
            output[cursor] = " ";
            state.inTemplate = false;
            index = cursor + 1;
            lastSignificant = "`";
            continue;
        }

        if (character === "/" && next === "/") {
            blank(index, line.length - 1);
            break;
        }
        if (character === "/" && next === "*") {
            state.inBlockComment = true;
            index += 2;
            continue;
        }
        if (character === '"' || character === "'") {
            const close = findStringEnd(line, index, character);
            if (close === -1) {
                blank(index, line.length - 1);
                return output.join("");
            }
            blank(index, close);
            index = close + 1;
            lastSignificant = character;
            continue;
        }
        if (character === "`") {
            const close = findStringEnd(line, index, "`");
            if (close === -1) {
                blank(index, line.length - 1);
                state.inTemplate = true;
                return output.join("");
            }
            blank(index, close);
            index = close + 1;
            lastSignificant = "`";
            continue;
        }
        if (character === "/" && (lastSignificant === "" || REGEX_PREFIXES.has(lastSignificant))) {
            const close = findRegexEnd(line, index);
            if (close !== -1) {
                blank(index, close);
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
    return output.join("");
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
    const output = [...line];
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
