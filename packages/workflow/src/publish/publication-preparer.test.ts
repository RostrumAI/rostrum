import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { digestWorkflow } from "../../tests/helpers/digest";
import { V1_RULE_SET } from "../rules/v1";
import { CanonicalizationError, canonicalize } from "./canonical-json";
import { PublicationPreparer } from "./publication-preparer";

const FIXTURES_DIR = join(import.meta.dir, "..", "..", "tests", "fixtures");
const preparer = new PublicationPreparer(V1_RULE_SET);

const SEQUENTIAL_DIGEST = "e7a05eeb289860e3e43d3054622d070e715893397d0ed44a8f814265bf46b368";

const EXPECTED_DIGESTS: Record<string, string> = {
  "sequential.json": SEQUENTIAL_DIGEST,
  "conditional-branching.json": "62060162c41188816562fcca6c75899f212f46fbda8ab41ebe458bfd93f8698a",
  "fan-out-fan-in.json": "c1083c2c9e495374be8d33950fd46d2e3bcae12d19848d794f71a08c9b47293e",
  "bounded-loop.json": "5003b9d73650da0605ffbdd11c61f2e370f10f23070f2ff136f01f679808fa92",
  "conditional-groups.json": "5793efea91c0206dc646b845b5656162906c70f2cf6ce88f8fb0e59bda4ea04b",
};

function loadValidFixture(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, "valid", file), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("PublicationPreparer digest vectors", () => {
  for (const [file, expected] of Object.entries(EXPECTED_DIGESTS)) {
    test(`reproduces the E1-S3 vector for ${file}`, async () => {
      const preparation = await preparer.prepare(loadValidFixture(file));
      expect(preparation.digest).toBe(expected);
    });
  }

  test("agrees with the independent test-scoped canonicalizer", async () => {
    for (const file of Object.keys(EXPECTED_DIGESTS)) {
      const document = loadValidFixture(file);
      const preparation = await preparer.prepare(document);
      expect(preparation.digest).toBe(await digestWorkflow(document));
    }
  });
});

describe("PublicationPreparer metadata handling", () => {
  test("a metadata-only edit leaves the digest unchanged", async () => {
    const document = loadValidFixture("sequential.json");
    const renamed = {
      ...document,
      name: "Renamed workflow",
      description: "Different description.",
    };
    const preparation = await preparer.prepare(renamed);
    expect(preparation.digest).toBe(SEQUENTIAL_DIGEST);
  });

  test("the canonical text includes metadata and matches the RFC 8785 form", async () => {
    const document = loadValidFixture("sequential.json");
    const preparation = await preparer.prepare(document);
    expect(preparation.canonicalText).toBe(canonicalize(document));
    expect(preparation.canonicalText).toContain('"name":"Greet and summarize"');
    expect(preparation.canonicalText.includes("\n")).toBe(false);
  });
});
describe("PublicationPreparer input constraints", () => {
  test("rejects non-finite numbers", async () => {
    const document = loadValidFixture("sequential.json");
    const steps = document.steps as Array<Record<string, unknown>>;
    const first = steps[0];
    if (!first) {
      throw new Error("fixture has no steps");
    }
    steps[0] = { ...first, outputs: { greeting: Infinity } };
    await expect(preparer.prepare(document)).rejects.toThrow(CanonicalizationError);
  });

  test("rejects documents that are not JSON objects", async () => {
    expect(preparer.prepare([] as unknown as object)).rejects.toThrow(/JSON object/);
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
