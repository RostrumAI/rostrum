import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { V1_WORKFLOW_FORMAT_RULE_SET } from "../rules/v1";
import { digestWorkflow } from "../testing/digest";
import { CanonicalizationError, canonicalize } from "./canonical-json";
import { PublicationCanonicalizer } from "./publication-canonicalizer";

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures");
const canonicalizer = new PublicationCanonicalizer(V1_WORKFLOW_FORMAT_RULE_SET);

// The committed digest vectors are the single source of truth for the
// digest suite; this file consumes the same manifest as the tests that
// ship them (tests/digest-vectors.test.ts).
const DIGEST_MANIFEST = JSON.parse(
    readFileSync(join(FIXTURES_DIR, "digest-vectors.json"), "utf8"),
) as Record<string, string>;

const EXPECTED_DIGESTS: Record<string, string> = Object.fromEntries(
    Object.entries(DIGEST_MANIFEST).map(([relative, digest]) => [
        relative.slice("valid/".length),
        digest,
    ]),
);

const SEQUENTIAL_DIGEST = EXPECTED_DIGESTS["sequential.json"];
if (SEQUENTIAL_DIGEST === undefined) {
    throw new Error("the digest manifest is missing sequential.json");
}

function loadValidFixture(file: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(FIXTURES_DIR, "valid", file), "utf8")) as Record<
        string,
        unknown
    >;
}

describe("PublicationCanonicalizer digest vectors", () => {
    for (const [file, expected] of Object.entries(EXPECTED_DIGESTS)) {
        test(`reproduces the published digest vector for ${file}`, async () => {
            const canonical = await canonicalizer.canonicalize(loadValidFixture(file));
            expect(canonical.digest).toBe(expected);
        });
    }

    test("agrees with the independent test-scoped canonicalizer", async () => {
        for (const file of Object.keys(EXPECTED_DIGESTS)) {
            const document = loadValidFixture(file);
            const canonical = await canonicalizer.canonicalize(document);
            expect(canonical.digest).toBe(await digestWorkflow(document));
        }
    });
});

describe("PublicationCanonicalizer metadata handling", () => {
    test("a metadata-only edit leaves the digest unchanged", async () => {
        const document = loadValidFixture("sequential.json");
        const renamed = {
            ...document,
            name: "Renamed workflow",
            description: "Different description.",
        };
        const canonical = await canonicalizer.canonicalize(renamed);
        expect(canonical.digest).toBe(SEQUENTIAL_DIGEST);
    });

    test("the canonical text includes metadata and matches the RFC 8785 form", async () => {
        const document = loadValidFixture("sequential.json");
        const canonical = await canonicalizer.canonicalize(document);
        expect(canonical.canonicalText).toBe(canonicalize(document));
        expect(canonical.canonicalText).toContain('"name":"Greet and summarize"');
        expect(canonical.canonicalText.includes("\n")).toBe(false);
    });
});
describe("PublicationCanonicalizer input constraints", () => {
    test("rejects non-finite numbers", async () => {
        const document = loadValidFixture("sequential.json");
        const steps = document.steps as Array<Record<string, unknown>>;
        const first = steps[0];
        if (!first) {
            throw new Error("fixture has no steps");
        }
        steps[0] = { ...first, outputs: { greeting: Infinity } };
        await expect(canonicalizer.canonicalize(document)).rejects.toThrow(CanonicalizationError);
    });

    test("rejects documents that are not JSON objects", async () => {
        expect(canonicalizer.canonicalize([] as unknown as object)).rejects.toThrow(/JSON object/);
    });
});

describe("fixture inventory", () => {
    test("every valid fixture has an expected digest vector", () => {
        const files = readdirSync(join(FIXTURES_DIR, "valid"))
            .filter((file) => file.endsWith(".json"))
            .sort();
        expect(Object.keys(EXPECTED_DIGESTS).sort()).toEqual(files);
    });
});
