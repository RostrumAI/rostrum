import type { CheckResult, Readiness } from "./protocol";

/** The stable failure codes a readiness check may report. */
export type CheckFailureCode = Extract<CheckResult, { status: "failed" }>["code"];

/**
 * One dependency probe in a readiness aggregate: the bounded check plus the
 * stable codes to report when it throws or never settles.
 */
export interface ReadinessProbe {
    /** Runs the bounded check. Must observe `signal` so a sibling failure can cancel it. */
    check(signal: AbortSignal): Promise<CheckResult>;
    /** Stable code reported when the overall deadline expires before this check settles. */
    timeoutCode: CheckFailureCode;
    /** Stable code reported when this check throws. */
    failureCode: CheckFailureCode;
}

/**
 * Runs dependency probes concurrently under one overall deadline.
 *
 * The first failed check resolves `not_ready` immediately and aborts its
 * unfinished siblings, so a known failure is never delayed by another
 * dependency's timeout. A check that has not settled by the deadline is
 * reported with its timeout code rather than omitted, so a `not_ready` body
 * never implies a dependency succeeded. A `ready` body requires every check
 * to have settled `ok`.
 */
export async function checkReadiness(
    probes: Record<string, ReadinessProbe>,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<Readiness> {
    const checks: Record<string, CheckResult> = {};
    const controller = new AbortController();
    const result = Promise.withResolvers<Readiness>();
    let settled = false;

    const stop = (final: Readiness): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onDeadline);
        // Cancel unfinished sibling work; a timed-out query or socket must stop.
        controller.abort();
        result.resolve(final);
    };

    const onDeadline = (): void => {
        for (const [name, probe] of Object.entries(probes)) {
            if (!(name in checks)) {
                checks[name] = { status: "failed", code: probe.timeoutCode };
            }
        }
        stop({ status: "not_ready", checks: { ...checks } });
    };

    const timer = setTimeout(onDeadline, timeoutMs);
    signal?.addEventListener("abort", onDeadline, { once: true });
    if (signal?.aborted) onDeadline();

    const entries = Object.entries(probes);
    let outstanding = entries.length;
    if (outstanding === 0) {
        stop({ status: "ready", checks: {} });
        return result.promise;
    }

    for (const [name, probe] of entries) {
        if (settled) break;
        void probe.check(controller.signal).then(
            (check) => {
                if (settled) return;
                checks[name] = check;
                outstanding -= 1;
                if (check.status === "failed") {
                    stop({ status: "not_ready", checks: { ...checks } });
                    return;
                }
                if (outstanding === 0) stop({ status: "ready", checks: { ...checks } });
            },
            () => {
                if (settled) return;
                checks[name] = { status: "failed", code: probe.failureCode };
                stop({ status: "not_ready", checks: { ...checks } });
            },
        );
    }

    return result.promise;
}
