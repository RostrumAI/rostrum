/**
 * Behavioural tests for adjudication verdicts, the retrospective's tallies, and
 * the thresholds that decide when a rule change is even proposable.
 *
 * @remarks
 * The retrospective's whole value is that it changes the corpus only when the
 * evidence warrants it. The failure modes are quiet ones: counting an accepted
 * tradeoff as a refutation would tune the rules toward whatever silences them,
 * and acting on two observations would tune them to noise. Those are the cases
 * pinned here.
 */

import { describe, expect, test } from "bun:test";

import { countReviewerReplies, renderBudgetExhaustedReply } from "./adjudicate.ts";
import type { ReviewThread } from "./github.ts";
import {
    aggregateByRule,
    type FindingOutcome,
    proposeRuleChanges,
    type RuleRecord,
} from "./retro.ts";
import { isWithdrawn, parseVerdict, renderVerdictMarker } from "./verdicts.ts";

/** Builds an outcome for a rule with the given verdicts. */
function outcomesFor(ruleId: string, verdicts: FindingOutcome["verdict"][]): FindingOutcome[] {
    return verdicts.map((verdict, index) => ({
        ruleId,
        path: "apps/control-api/src/thing.ts",
        pullRequest: index + 1,
        verdict,
    }));
}

/** Builds a rule record directly, for threshold cases. */
function recordFor(overrides: Partial<RuleRecord>): RuleRecord {
    return {
        ruleId: "REPO-TEST-03",
        fired: 0,
        refuted: 0,
        intentional: 0,
        codeChanged: 0,
        stands: 0,
        needsHuman: 0,
        unadjudicated: 0,
        pullRequests: [1],
        ...overrides,
    };
}

describe("verdict markers", () => {
    test("round-trips every verdict through a comment body", () => {
        for (const verdict of [
            "refuted",
            "intentional",
            "code_changed",
            "stands",
            "needs_human",
        ] as const) {
            expect(parseVerdict(renderVerdictMarker(verdict))).toBe(verdict);
        }
    });

    test("finds the marker inside a reply that also carries prose", () => {
        const body = `${renderVerdictMarker("stands")}\n\nRe-read create.ts; the reply does not address the status code.`;
        expect(parseVerdict(body)).toBe("stands");
    });

    test("ignores prose that names a verdict without recording one", () => {
        expect(parseVerdict("I think this should be refuted, but let me check.")).toBeNull();
        expect(parseVerdict("no marker here")).toBeNull();
    });

    test("treats only the withdrawing verdicts as withdrawn", () => {
        expect(isWithdrawn("refuted")).toBe(true);
        expect(isWithdrawn("intentional")).toBe(true);
        expect(isWithdrawn("code_changed")).toBe(true);
        expect(isWithdrawn("stands")).toBe(false);
        expect(isWithdrawn("needs_human")).toBe(false);
    });
});

describe("reply budget", () => {
    /** Builds a thread from a list of comment bodies. */
    function threadOf(bodies: string[]): ReviewThread {
        return {
            id: "t1",
            isResolved: false,
            isOutdated: false,
            path: "apps/control-api/src/thing.ts",
            line: 2,
            comments: bodies.map((body, index) => ({
                id: index + 1,
                author: index === 0 ? "github-actions[bot]" : "someone",
                authorAssociation: "MEMBER",
                body,
                line: null,
            })),
        };
    }

    test("counts reviewer verdicts, not the human replies they answer", () => {
        const thread = threadOf([
            "<!-- rostrum-code-review -->\n**`REPO-A-01` · major** — thing",
            "I disagree with this.",
            renderVerdictMarker("stands"),
            "I still disagree.",
            renderVerdictMarker("stands"),
        ]);
        expect(countReviewerReplies(thread)).toBe(2);
    });

    test("counts nothing on a thread with no reviewer finding", () => {
        expect(countReviewerReplies(threadOf(["just a human comment"]))).toBe(0);
    });

    test("the closing reply hands over rather than withdrawing", () => {
        // It must not withdraw: a disagreement the reviewer cannot settle is not
        // the same as a finding it accepts is wrong, so the thread stays open.
        const verdict = parseVerdict(renderBudgetExhaustedReply(3));
        expect(verdict).toBe("needs_human");
        expect(verdict !== null && isWithdrawn(verdict)).toBe(false);
    });
});

describe("outcome aggregation", () => {
    test("tallies each verdict separately", () => {
        const records = aggregateByRule([
            ...outcomesFor("REPO-A-01", ["refuted", "refuted", "stands", "intentional"]),
        ]);
        const record = records[0];
        expect(record?.fired).toBe(4);
        expect(record?.refuted).toBe(2);
        expect(record?.stands).toBe(1);
        expect(record?.intentional).toBe(1);
    });

    test("counts a thread with no verdict as unadjudicated, not as agreement", () => {
        const records = aggregateByRule(outcomesFor("REPO-A-01", ["open", "open"]));
        expect(records[0]?.unadjudicated).toBe(2);
        expect(records[0]?.refuted).toBe(0);
    });

    test("collects the pull requests that produced a rule's findings", () => {
        const records = aggregateByRule([
            { ruleId: "REPO-A-01", path: "a.ts", pullRequest: 7, verdict: "stands" },
            { ruleId: "REPO-A-01", path: "a.ts", pullRequest: 7, verdict: "refuted" },
            { ruleId: "REPO-A-01", path: "b.ts", pullRequest: 9, verdict: "refuted" },
        ]);
        expect(records[0]?.pullRequests).toEqual([7, 9]);
    });

    test("keeps rules separate and orders them by id", () => {
        const records = aggregateByRule([
            ...outcomesFor("REPO-B-01", ["stands"]),
            ...outcomesFor("REPO-A-01", ["stands"]),
        ]);
        expect(records.map((record) => record.ruleId)).toEqual(["REPO-A-01", "REPO-B-01"]);
    });
});

describe("rule proposals", () => {
    const severities = new Map([
        ["REPO-A-01", "major"],
        ["REPO-B-01", "blocking"],
    ]);

    test("proposes nothing from too few observations", () => {
        const records = [recordFor({ fired: 2, refuted: 2 })];
        expect(proposeRuleChanges(records, severities)).toHaveLength(0);
    });

    test("proposes narrowing a rule that is mostly refuted", () => {
        const records = [recordFor({ ruleId: "REPO-A-01", fired: 10, refuted: 5, stands: 5 })];
        const proposals = proposeRuleChanges(records, severities);
        expect(proposals).toHaveLength(1);
        expect(proposals[0]?.change).toBe("narrow");
        expect(proposals[0]?.summary).toContain("50%");
    });

    test("sends a noisy blocking rule to a human instead of proposing an edit", () => {
        const records = [recordFor({ ruleId: "REPO-B-01", fired: 10, refuted: 6, stands: 4 })];
        const proposals = proposeRuleChanges(records, severities);
        expect(proposals[0]?.change).toBe("human-review");
    });

    test("lower the severity when nothing is upheld and nothing is refuted", () => {
        const records = [
            recordFor({ ruleId: "REPO-A-01", fired: 8, intentional: 5, codeChanged: 3 }),
        ];
        const proposals = proposeRuleChanges(records, severities);
        expect(proposals[0]?.change).toBe("downgrade-severity");
    });

    test("does not lower severity while a finding is still being upheld", () => {
        // Accepted tradeoffs are not evidence the rule is unimportant: one upheld
        // finding means the rule is still finding something real.
        const records = [
            recordFor({ ruleId: "REPO-A-01", fired: 8, intentional: 4, codeChanged: 3, stands: 1 }),
        ];
        expect(proposeRuleChanges(records, severities)).toHaveLength(0);
    });

    test("leaves a healthy rule alone", () => {
        const records = [recordFor({ ruleId: "REPO-A-01", fired: 10, stands: 8, refuted: 2 })];
        expect(proposeRuleChanges(records, severities)).toHaveLength(0);
    });
});
