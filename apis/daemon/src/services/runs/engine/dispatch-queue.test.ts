/**
 * @fileoverview Tests the per-run index of ready visits the workflow engine
 * draws dispatch candidates from. The engine relies on it to offer work in
 * the order it became ready, to keep runs apart, and to stop rescheduling a
 * run once nothing is left.
 *
 * DispatchQueue
 * - returns candidates in offer order without duplicates: a repeated offer
 *   merges, and an empty queue returns undefined.
 * - keeps runs apart: clearing one run leaves another run's candidates.
 * - reports when a run is empty: `has` is false before any offer and after
 *   the last candidate is taken.
 * - accepts a candidate again after it was taken: a retried visit can be
 *   offered and returned again.
 */
import { describe, expect, test } from "bun:test";
import { DispatchQueue } from "./dispatch-queue";

describe("DispatchQueue", () => {
    // Proves candidates come out in the order they were first offered, and repeats merge.
    test("returns candidates in offer order without duplicates", () => {
        const queue = new DispatchQueue();
        queue.offer("run-1", "a");
        queue.offer("run-1", "b");
        queue.offer("run-1", "a");
        expect([queue.next("run-1"), queue.next("run-1"), queue.next("run-1")]).toEqual([
            "a",
            "b",
            undefined,
        ]);
    });

    // Proves each run has its own candidates, and clearing one leaves the others.
    test("keeps runs apart", () => {
        const queue = new DispatchQueue();
        queue.offer("run-1", "a");
        queue.offer("run-2", "b");
        queue.clear("run-1");
        expect(queue.has("run-1")).toBe(false);
        expect(queue.next("run-2")).toBe("b");
    });

    // Proves a run with no candidates left reports none, so dispatch stops rescheduling.
    test("reports when a run is empty", () => {
        const queue = new DispatchQueue();
        expect(queue.has("run-1")).toBe(false);
        queue.offer("run-1", "a");
        expect(queue.has("run-1")).toBe(true);
        queue.next("run-1");
        expect(queue.has("run-1")).toBe(false);
    });

    // Proves a candidate taken out can be offered again, as a retried visit would be.
    test("accepts a candidate again after it was taken", () => {
        const queue = new DispatchQueue();
        queue.offer("run-1", "a");
        queue.next("run-1");
        queue.offer("run-1", "a");
        expect(queue.next("run-1")).toBe("a");
    });
});
