import { describe, expect, test } from "bun:test";
import { createLogger } from "./logger";

function collectLogger(level: Parameters<typeof createLogger>[0]) {
  const lines: string[] = [];
  const logger = createLogger(level, (line) => lines.push(line));
  return { lines, logger };
}

function parsed(lines: string[]): Array<Record<string, unknown>> {
  expect(lines.length).toBeGreaterThan(0);
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("createLogger", () => {
  test("emits one JSON line per call with time, level, and message", () => {
    const { lines, logger } = collectLogger("debug");
    logger.info("listening", { port: 3000 });
    const [entry] = parsed(lines);
    expect(entry).toBeDefined();
    expect(entry?.level).toBe("info");
    expect(entry?.msg).toBe("listening");
    expect(entry?.port).toBe(3000);
    expect(typeof entry?.time).toBe("string");
    expect(new Date(entry?.time as string).getTime()).not.toBeNaN();
  });

  test("merges fields into the line", () => {
    const { lines, logger } = collectLogger("debug");
    logger.warn("handler failed", { error: "boom", path: "/api/v1/health" });
    const [entry] = parsed(lines);
    expect(entry).toBeDefined();
    expect(entry?.error).toBe("boom");
    expect(entry?.path).toBe("/api/v1/health");
  });

  test("filters out levels below the configured threshold", () => {
    const { lines, logger } = collectLogger("warn");
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("shown");
    logger.error("also shown");
    const entries = parsed(lines);
    expect(entries).toHaveLength(2);
    const [warnEntry, errorEntry] = entries;
    expect(warnEntry?.level).toBe("warn");
    expect(errorEntry?.level).toBe("error");
  });
});
