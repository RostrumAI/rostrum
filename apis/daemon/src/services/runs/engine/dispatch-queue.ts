/** @fileoverview The index of ready visits the engine may dispatch, per run. */

/**
 * The in-memory index of ready work, per run and in the order it became
 * ready. It is not the source of truth: an entry only suggests that a
 * visit may be claimable, and duplicate offers are merged.
 */
export class DispatchQueue {
    private readonly candidates = new Map<string, Set<string>>();

    /** Offers a visit as a candidate; offering it again changes nothing. */
    offer(runId: string, visitKey: string): void {
        const keys = this.candidates.get(runId) ?? new Set<string>();
        keys.add(visitKey);
        this.candidates.set(runId, keys);
    }

    /** Removes and returns the run's oldest candidate, if any. */
    next(runId: string): string | undefined {
        const keys = this.candidates.get(runId);
        const [first] = keys ?? [];
        if (keys && first !== undefined) {
            keys.delete(first);
            if (keys.size === 0) {
                this.candidates.delete(runId);
            }
        }
        return first;
    }

    /** True when the run has candidates left. */
    has(runId: string): boolean {
        return this.candidates.has(runId);
    }

    /** Drops every candidate of a run that can no longer dispatch. */
    clear(runId: string): void {
        this.candidates.delete(runId);
    }
}
