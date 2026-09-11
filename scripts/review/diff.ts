/**
 * Unified-diff parsing for the automated review pipeline.
 *
 * @remarks
 * GitHub rejects a review comment anchored to a line the diff does not show, so
 * every finding must be resolved against the parsed hunks before it is posted.
 * This module owns that mapping: which line numbers exist for a file, which of
 * them the pull request introduced, and where a finding that landed outside the
 * visible window should be moved to.
 */

import type { DiffHunk, FileDiff } from "./types.ts";

/** Matches a hunk header, capturing the old and new file ranges. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Extensions for files that carry no reviewable source lines. */
const BINARY_SUFFIXES = [".dump", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".woff"];

/**
 * Decides whether a path is worth parsing and reviewing.
 *
 * A comment anchored inside a lockfile or a binary artifact is noise, and a
 * binary body has no line numbers to anchor to.
 *
 * @param path - Repository-relative path from the diff.
 * @returns True when the file should be reviewed.
 */
export function isReviewablePath(path: string): boolean {
    const normalized = path.toLowerCase();
    if (normalized.endsWith("bun.lock") || normalized.endsWith("bun.lockb")) {
        return false;
    }
    return !BINARY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/**
 * Removes the `a/` or `b/` prefix Git writes in diff paths.
 *
 * @param path - Raw path from the patch.
 * @returns The repository-relative path.
 */
export function stripPathPrefix(path: string): string {
    const trimmed = path.replace(/^\.\//, "");
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        const quoted = trimmed.slice(1, -1);
        return quoted.startsWith("a/") || quoted.startsWith("b/") ? quoted.slice(2) : quoted;
    }
    return trimmed.startsWith("a/") || trimmed.startsWith("b/") ? trimmed.slice(2) : trimmed;
}

/**
 * Parses a unified diff into per-file hunks indexed by new-file line number.
 *
 * Deleted and renamed files appear with no hunks, so a caller can still report
 * that the pull request touched them. Lockfiles and binary artifacts are dropped
 * entirely: they have no reviewable lines and no line to anchor a comment to.
 *
 * @param patch - Unified diff text, as produced by `gh pr diff` or `git diff`.
 * @returns One entry per reviewable file, in patch order.
 */
export function parseUnifiedDiff(patch: string): FileDiff[] {
    const files: FileDiff[] = [];
    let current: FileDiff | null = null;
    let hunk: DiffHunk | null = null;
    let newLine = 0;

    for (const raw of patch.split("\n")) {
        if (raw.startsWith("diff --git ")) {
            const halves = raw.slice("diff --git ".length).split(" b/");
            const candidate = halves.length > 1 ? halves.slice(1).join(" b/") : (halves[0] ?? "");
            current = {
                path: stripPathPrefix(candidate),
                hunks: [],
                added: false,
                deleted: false,
            };
            files.push(current);
            hunk = null;
            continue;
        }
        if (current === null) {
            continue;
        }
        if (raw.startsWith("new file mode")) {
            current.added = true;
            continue;
        }
        if (raw.startsWith("deleted file mode")) {
            current.deleted = true;
            continue;
        }
        if (raw.startsWith("+++ ") && hunk === null) {
            // Only a position outside a hunk holds the file header. Inside a hunk
            // this text is an added line whose content begins with `++ `, and
            // treating it as a header would drop the line and rename the file.
            const path = stripPathPrefix(raw.slice(4).trim());
            current.path = path === "/dev/null" ? current.path : path;
            continue;
        }
        if (raw.startsWith("@@")) {
            const match = HUNK_HEADER.exec(raw);
            if (match === null) {
                hunk = null;
                continue;
            }
            hunk = { header: raw, newLines: [], addedLines: [], text: new Map() };
            newLine = Number(match[3]);
            current.hunks.push(hunk);
            continue;
        }
        if (hunk === null || raw.startsWith("\\")) {
            continue;
        }
        const marker = raw.slice(0, 1);
        const text = raw.slice(1);
        if (marker === "+") {
            hunk.newLines.push(newLine);
            hunk.addedLines.push(newLine);
            hunk.text.set(newLine, text);
            newLine += 1;
        } else if (marker === "-") {
            // Removed lines exist only on the old side; they carry no new-file number.
        } else if (marker === " ") {
            hunk.newLines.push(newLine);
            hunk.text.set(newLine, text);
            newLine += 1;
        }
        // Anything else is patch metadata or the empty tail of a trailing newline.
    }

    return files.filter((file) => isReviewablePath(file.path));
}

/**
 * Lists the new-file line numbers of a file's diff.
 *
 * Findings are anchored to added lines, so callers that only need the lines the
 * change introduced pass `"added"`; callers resolving an existing comment pass
 * `"all"` to include the context lines GitHub also accepts comments on.
 *
 * @param file - Parsed file diff.
 * @param kind - Which lines to return: every visible line, or only added ones.
 * @returns Ascending line numbers.
 */
export function visibleLines(file: FileDiff, kind: "all" | "added" = "all"): number[] {
    const kindLines = new Set<number>();
    for (const hunk of file.hunks) {
        for (const line of kind === "added" ? hunk.addedLines : hunk.newLines) {
            kindLines.add(line);
        }
    }
    return [...kindLines].sort((left, right) => left - right);
}

/** One line visible in a file's diff, with its region markers. */
export interface LineEntry {
    /** New-file line number. */
    line: number;
    /** Line contents without the leading diff marker. */
    text: string;
    /** True when the pull request introduces this line. */
    added: boolean;
}

/**
 * Returns every line a file's diff shows, in source order.
 *
 * Context lines are included so a scanner can carry lexical state — an open
 * template literal, an open block comment — from an unchanged line into a
 * changed one. Hunk boundaries are respected: state does not leak across a gap
 * the diff elided, because the elided text is unknown.
 *
 * @param file - Parsed file diff.
 * @returns Line entries in source order.
 */
export function visibleLineEntries(file: FileDiff): LineEntry[] {
    const entries: LineEntry[] = [];
    for (const hunk of file.hunks) {
        const added = new Set(hunk.addedLines);
        for (const line of hunk.newLines) {
            entries.push({
                line,
                text: hunk.text.get(line) ?? "",
                added: added.has(line),
            });
        }
    }
    return entries.sort((left, right) => left.line - right.line);
}

/**
 * Moves a finding's line onto a line the diff shows, preferring added lines.
 *
 * A reviewer that names a line just outside the hunk is usually pointing at the
 * right code, so the finding is re-anchored rather than dropped. Snapping is
 * bounded by `tolerance` so a wildly wrong line number is rejected instead of
 * being silently relocated.
 *
 * @param file - Parsed file diff the finding belongs to.
 * @param line - Line number the reviewer reported.
 * @param tolerance - Maximum distance in lines to move the finding.
 * @returns The anchored line number, or null when no nearby visible line exists.
 */
export function snapToDiff(file: FileDiff, line: number, tolerance = 5): number | null {
    const visible = visibleLines(file);
    if (visible.length === 0) {
        return null;
    }
    if (visible.includes(line)) {
        return line;
    }
    const preferred = visibleLines(file, "added");
    const candidates = preferred.length > 0 ? preferred : visible;
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const distance = Math.abs(candidate - line);
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return best !== null && bestDistance <= tolerance ? best : null;
}

/**
 * Identifies the hunk a line belongs to, so findings in one region of a file can
 * be recognised as describing the same issue.
 *
 * @param file - Parsed file diff.
 * @param line - Line number at the head commit.
 * @returns The hunk's index in the file, or -1 when no hunk contains the line.
 */
export function hunkIndexOf(file: FileDiff, line: number): number {
    return file.hunks.findIndex((hunk) => hunk.newLines.includes(line));
}

/**
 * Finds the parsed diff for a path, tolerating the prefixes Git may add.
 *
 * @param files - Parsed file diffs.
 * @param path - Path as reported by a reviewer.
 * @returns The matching file diff, or null when the path is not in the change.
 */
export function findFile(files: FileDiff[], path: string): FileDiff | null {
    const normalized = stripPathPrefix(path);
    return files.find((file) => file.path === normalized) ?? null;
}
