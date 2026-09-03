/**
 * Startup configuration guard shared by both proof processes. It mirrors the
 * guard in apps/control-api/src/env.ts: an integer variable that fails
 * validation aborts startup with the offending path before the socket opens.
 */
export function requireIntegerEnv(
    value: string | undefined,
    path: string,
    fallback: number,
): number {
    if (value === undefined) return fallback;
    if (!/^-?\d+$/.test(value)) {
        throw new Error(
            `invalid configuration: /${path} must be an integer, got ${JSON.stringify(value)}`,
        );
    }
    return Number(value);
}