/**
 * Adjudication verdicts and the marker that carries them in a thread.
 *
 * @remarks
 * A human reply is not by itself a disposition. The reviewer argues and a human
 * answers, so the pipeline needs to record *why* a finding stopped being raised,
 * not merely that someone replied. The distinction is what makes the weekly
 * retrospective possible: only a refutation is evidence that a rule is wrong.
 * A maintainer accepting a deliberate tradeoff says nothing about the rule, and
 * a finding that was simply fixed says nothing either.
 *
 * The verdict lives in the reviewer's own reply as a hidden marker, so the
 * conversation remains the whole state of the pipeline and no database is
 * introduced.
 */

/** How a thread's finding was dispositioned. */
export type Verdict =
    /** The reply is correct and the finding was wrong. The only rule-quality signal. */
    | "refuted"
    /** The maintainer accepts the behaviour deliberately. */
    | "intentional"
    /** The code already changed in the direction the finding asked for. */
    | "code_changed"
    /** The finding holds after re-reading the code. */
    | "stands"
    /** Genuinely ambiguous, or the argument has run its course. */
    | "needs_human";

/** Verdicts that end a thread's finding. */
export const WITHDRAWING_VERDICTS: readonly Verdict[] = ["refuted", "intentional", "code_changed"];

/** Marker prefix identifying a verdict comment. */
const VERDICT_PREFIX = "<!-- rostrum-verdict:";

/** Every verdict, for validation. */
const ALL_VERDICTS: readonly Verdict[] = [
    "refuted",
    "intentional",
    "code_changed",
    "stands",
    "needs_human",
];

/**
 * Renders the hidden marker that records a verdict.
 *
 * @param verdict - Verdict to record.
 * @returns Marker text to place in a reply body.
 */
export function renderVerdictMarker(verdict: Verdict): string {
    return `${VERDICT_PREFIX}${verdict} -->`;
}

/**
 * Reads the verdict a comment records, if it records one.
 *
 * @param body - Comment body.
 * @returns The verdict, or null when the comment carries none or an unknown one.
 */
export function parseVerdict(body: string): Verdict | null {
    const match = /<!-- rostrum-verdict:([a-z_]+) -->/.exec(body);
    const candidate = match?.[1];
    if (candidate === undefined) {
        return null;
    }
    return ALL_VERDICTS.find((verdict) => verdict === candidate) ?? null;
}

/**
 * Reports whether a verdict withdraws the finding on its thread.
 *
 * @param verdict - Verdict to test.
 * @returns True when the finding should no longer be raised.
 */
export function isWithdrawn(verdict: Verdict): boolean {
    return WITHDRAWING_VERDICTS.includes(verdict);
}
