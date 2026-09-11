/**
 * Line-level source scanning for the deterministic rule pass.
 *
 * @remarks
 * A pattern check must run against code, not against text that happens to
 * contain code. Without this, a banned identifier inside a string literal, a
 * regex that matches banned identifiers, or a fixture embedded in a template
 * literal all read as violations — which is exactly what happened when the
 * corpus first reviewed its own rule files.
 *
 * The scanner blanks the contents of comments, string literals, template
 * literals, and regular-expression literals, preserving character positions so
 * a match offset still points at the right column.
 */

/**
 * Characters after which a `/` begins a regular expression rather than a division.
 *
 * Detection is deliberately conservative: a `/` in an unrecognised position is
 * treated as division, which leaves the text unstripped. Leaving text in place
 * can only produce an extra finding, never hide one.
 */
const REGEX_PREFIXES = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", ">"]);

/**
 * Blanks the non-code regions of a source line.
 *
 * Replaces the contents of comments, string literals, template literals, and
 * regex literals with spaces of the same length, so the result has the same
 * length as the input and any index into it still refers to the same column.
 *
 * @param line - A single line of source.
 * @returns The line with non-code regions blanked.
 */
export function blankNonCode(line: string): string {
    const output = [...line];
    let index = 0;
    let lastSignificant = "";
    while (index < line.length) {
        const character = line[index] ?? "";
        const next = line[index + 1] ?? "";
        if (character === "/" && next === "/") {
            for (let rest = index; rest < line.length; rest += 1) {
                output[rest] = " ";
            }
            break;
        }
        if (character === '"' || character === "'" || character === "`") {
            const quote = character;
            let cursor = index + 1;
            while (cursor < line.length) {
                const inner = line[cursor] ?? "";
                if (inner === "\\") {
                    output[cursor] = " ";
                    output[cursor + 1] = " ";
                    cursor += 2;
                    continue;
                }
                if (inner === quote) {
                    break;
                }
                output[cursor] = " ";
                cursor += 1;
            }
            output[index] = " ";
            if (cursor < line.length) {
                output[cursor] = " ";
            }
            index = cursor + 1;
            lastSignificant = quote;
            continue;
        }
        if (character === "/" && (lastSignificant === "" || REGEX_PREFIXES.has(lastSignificant))) {
            let cursor = index + 1;
            let inClass = false;
            let terminated = false;
            while (cursor < line.length) {
                const inner = line[cursor] ?? "";
                if (inner === "\\") {
                    output[cursor] = " ";
                    output[cursor + 1] = " ";
                    cursor += 2;
                    continue;
                }
                if (inner === "[") {
                    inClass = true;
                } else if (inner === "]") {
                    inClass = false;
                } else if (inner === "/" && !inClass) {
                    terminated = true;
                    break;
                }
                output[cursor] = " ";
                cursor += 1;
            }
            if (terminated) {
                output[index] = " ";
                output[cursor] = " ";
                index = cursor + 1;
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
