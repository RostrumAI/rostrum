import { describe, expect, test } from "bun:test";
import { loadConfig, parseLogLevel } from "./config";

describe("loadConfig", () => {
  test("uses documented defaults for an empty environment", () => {
    const config = loadConfig({});
    expect(config).toEqual({
      host: "127.0.0.1",
      port: 3000,
      databaseUrl: "postgres://rostrum:rostrum@localhost:5432/rostrum",
      logLevel: "info",
    });
  });

  test("applies environment overrides", () => {
    const config = loadConfig({
      HOST: "0.0.0.0",
      PORT: "8080",
      DATABASE_URL: "postgres://other:secret@db:5432/rostrum",
      LOG_LEVEL: "debug",
    });
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
    expect(config.databaseUrl).toBe("postgres://other:secret@db:5432/rostrum");
    expect(config.logLevel).toBe("debug");
  });

  test("rejects a non-numeric or out-of-range PORT", () => {
    for (const bad of ["abc", "3.5", "-1", "70000"]) {
      expect(() => loadConfig({ PORT: bad })).toThrow(`invalid PORT: ${bad}`);
    }
  });

  test("accepts port 0 (ephemeral port for process tests)", () => {
    expect(loadConfig({ PORT: "0" }).port).toBe(0);
  });

  test("falls back to info for an unknown LOG_LEVEL", () => {
    expect(parseLogLevel("verbose")).toBe("info");
    expect(parseLogLevel(undefined)).toBe("info");
  });
});
