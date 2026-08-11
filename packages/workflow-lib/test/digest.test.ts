import { describe, expect, test } from "bun:test";
import { canonicalJson, workflowDigest } from "../src/digest";

const sample = {
  interfaceVersion: "v1",
  id: "wf-hello",
  name: "Hello",
  createdAt: "2026-08-10T12:00:00.000Z",
  start: "say",
  steps: [
    { id: "say", type: "task", next: "done" },
    { id: "done", type: "result" },
  ],
};

// Known vector: SHA-256 over the canonical JSON below. Guards against
// accidental changes to the digest rule (provisional until E1-S3).
const canonical =
  '{"createdAt":"2026-08-10T12:00:00.000Z","id":"wf-hello","interfaceVersion":"v1","name":"Hello","start":"say","steps":[{"id":"say","next":"done","type":"task"},{"id":"done","type":"result"}]}';
const KNOWN_DIGEST = "d66633da6dfd8c3724c67a6988158b13782d1e4d7515e296c6f4afb06d46905f";

describe("canonicalJson", () => {
  test("sorts object keys recursively", () => {
    expect(canonicalJson(sample)).toBe(canonical);
  });

  test("is independent of input key order", () => {
    const reordered = {
      steps: sample.steps,
      start: sample.start,
      createdAt: sample.createdAt,
      name: sample.name,
      id: sample.id,
      interfaceVersion: sample.interfaceVersion,
    };
    expect(canonicalJson(reordered)).toBe(canonicalJson(sample));
  });
});

describe("workflowDigest", () => {
  test("matches the known vector", () => {
    expect(workflowDigest(sample)).toBe(KNOWN_DIGEST);
  });

  test("changes when content changes", () => {
    const changed = { ...sample, name: "Changed" };
    expect(workflowDigest(changed)).not.toBe(workflowDigest(sample));
  });
});
