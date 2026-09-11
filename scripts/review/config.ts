/**
 * Validated numeric configuration for the review pipeline.
 *
 * @remarks
 * Every knob in this pipeline is read the same way, and every one of them fails
 * silently when it is wrong. A `NaN` confidence floor compares false against
 * every finding, so the review reports nothing and looks clean; a zero
 * concurrency runs no reviewer at all. Both are configuration mistakes, so they
 * are reported as such rather than absorbed.
 */

/**
 * Parses a numeric override, rejecting a value that is not a usable number.
 *
 * @param raw - Value from the command line or the environment, if either was set.
 * @param fallback - Value to use when no override was supplied.
 * @param label - Name of the setting, used in the error message.
 * @param bounds - Inclusive range the value must fall within.
 * @returns The parsed value, or the fallback.
 * @throws Error when the override is present but not an integer within its bounds.
 */
export function numericOption(
    raw: string | undefined,
    fallback: number,
    label: string,
    bounds: { min: number; max: number },
): number {
    if (raw === undefined || raw.trim().length === 0) {
        return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new Error(`Invalid ${label}: "${raw}" is not an integer.`);
    }
    if (parsed < bounds.min || parsed > bounds.max) {
        throw new Error(
            `Invalid ${label}: ${parsed} is outside the range ${bounds.min} to ${bounds.max}.`,
        );
    }
    return parsed;
}
