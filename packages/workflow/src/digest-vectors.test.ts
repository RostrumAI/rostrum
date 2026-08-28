import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PublicationPreparer } from "../src/publish/publication-preparer";
import { V1_RULE_SET } from "../src/rules/v1";
import { digestWorkflow } from "./testing/digest";

/**
 * Digest vectors for the publication contract: SHA-256 lowercase hex
 * over the RFC 8785 canonical form of the document with the metadata
 * members (`name`, `description` in v1) removed.
 *
 * Every vector was reproduced independently before it shipped: once by
 * the library's canonicalizer (`PublicationPreparer`) and once by a
 * separate implementation written against RFC 8785 alone.
 */

const FIXTURES_DIR = join(import.meta.dir, "fixtures");

const vectors = JSON.parse(
    readFileSync(join(FIXTURES_DIR, "digest-vectors.json"), "utf8"),
) as Record<string, string>;

const preparer = new PublicationPreparer(V1_RULE_SET);

function loadFixture(relative: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(FIXTURES_DIR, relative), "utf8")) as Record<
        string,
        unknown
    >;
}

const sequentialDigest = vectors["valid/sequential.json"];
if (sequentialDigest === undefined) {
    throw new Error("the manifest is missing valid/sequential.json");
}

describe("each valid fixture reproduces its committed digest vector", () => {
    for (const [relative, expected] of Object.entries(vectors)) {
        test(relative, async () => {
            const document = loadFixture(relative);
            const { digest } = await preparer.prepare(document);
            expect(digest).toBe(expected);
        });
    }
});

describe("the second implementation agrees on every vector", () => {
    for (const [relative, expected] of Object.entries(vectors)) {
        test(relative, async () => {
            const document = loadFixture(relative);
            expect(await digestWorkflow(document)).toBe(expected);
        });
    }
});

describe("digest invariance", () => {
    test("reformatting the text does not change the digest", async () => {
        const compact = JSON.stringify(loadFixture("valid/sequential.json"));
        expect((await preparer.prepare(JSON.parse(compact))).digest).toBe(sequentialDigest);
    });

    test("reordering object members does not change the digest", async () => {
        const document = loadFixture("valid/sequential.json");
        const reversed: Record<string, unknown> = {};
        for (const key of Object.keys(document).reverse()) {
            reversed[key] = document[key];
        }
        expect((await preparer.prepare(reversed)).digest).toBe(sequentialDigest);
    });

    test("a metadata-only edit leaves the digest unchanged", async () => {
        const renamed = {
            ...loadFixture("valid/sequential.json"),
            name: "Renamed workflow",
            description: "Different description.",
        };
        expect((await preparer.prepare(renamed)).digest).toBe(sequentialDigest);
    });

    test("an operational edit changes the digest", async () => {
        const edited = {
            ...loadFixture("valid/minimum.json"),
            name: "Minimum workflow",
            firstNode: "0192b0a0-7e1d-7000-8000-000000000099",
        };
        const { digest } = await preparer.prepare(edited);
        expect(digest).not.toBe(vectors["valid/minimum.json"]);
        expect(digest).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe("every valid fixture is covered by a committed vector", () => {
    test("the manifest lists each file in valid/", () => {
        const files = readdirSync(join(FIXTURES_DIR, "valid"))
            .filter((file) => file.endsWith(".json"))
            .sort()
            .map((file) => `valid/${file}`);
        expect(Object.keys(vectors).sort()).toEqual(files);
    });
});
