import { describe, expect, test } from "bun:test";
import { compareFindings, type Finding, FindingFactory, sortFindings } from "./findings";

describe("finding ordering", () => {
  test("sorts by pointer, then code, in UTF-16 code-unit order", () => {
    const findings: Finding[] = [
      { code: "workflow.b", message: "", blocking: true, path: "/steps/2" },
      { code: "workflow.a", message: "", blocking: true, path: "/steps/10" },
      { code: "workflow.z", message: "", blocking: true, path: "" },
      { code: "workflow.a", message: "", blocking: true, path: "/steps/2" },
    ];
    const sorted = sortFindings(findings);
    expect(sorted.map((finding) => `${finding.path}|${finding.code}`)).toEqual([
      "|workflow.z",
      "/steps/10|workflow.a",
      "/steps/2|workflow.a",
      "/steps/2|workflow.b",
    ]);
  });

  test("compareFindings is stable for equal pointer and code", () => {
    const finding: Finding = { code: "workflow.a", message: "", blocking: true, path: "/a" };
    expect(compareFindings(finding, { ...finding })).toBe(0);
  });

  test("sortFindings does not mutate the input", () => {
    const findings: Finding[] = [
      { code: "workflow.b", message: "", blocking: true, path: "/b" },
      { code: "workflow.a", message: "", blocking: true, path: "/a" },
    ];
    sortFindings(findings);
    expect(findings.map((finding) => finding.path)).toEqual(["/b", "/a"]);
  });
});

describe("finding factory", () => {
  const sourceMap = {
    "": { value: { line: 1, column: 1 }, valueEnd: { line: 1, column: 2 } },
    "/a": { value: { line: 3, column: 7 }, valueEnd: { line: 3, column: 9 } },
  };

  test("attaches line and column from the source map", () => {
    const factory = new FindingFactory(sourceMap);
    const finding = factory.create({ code: "workflow.test", message: "m", path: "/a" });
    expect(finding.line).toBe(3);
    expect(finding.column).toBe(7);
  });

  test("omits line and column for pointers outside the map", () => {
    const factory = new FindingFactory(sourceMap);
    const finding = factory.create({ code: "workflow.test", message: "m", path: "/missing" });
    expect(finding.line).toBeUndefined();
    expect(finding.column).toBeUndefined();
  });

  test("omits line and column without a source map", () => {
    const factory = new FindingFactory(null);
    const finding = factory.create({ code: "workflow.test", message: "m", path: "/a" });
    expect(finding.line).toBeUndefined();
  });

  test("defaults blocking to true and carries related locations and details", () => {
    const factory = new FindingFactory(null);
    const finding = factory.create({
      code: "workflow.test",
      message: "m",
      path: "",
      blocking: false,
      relatedLocations: [{ path: "/b", message: "related" }],
      details: { key: "value" },
    });
    expect(finding.blocking).toBe(false);
    expect(finding.relatedLocations).toEqual([{ path: "/b", message: "related" }]);
    expect(finding.details).toEqual({ key: "value" });
  });
});
