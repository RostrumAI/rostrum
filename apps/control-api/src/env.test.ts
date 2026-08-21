import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, readConfigLayer } from "./env";

describe("loadConfig", () => {
  test("uses documented defaults for an empty environment", () => {
    expect(loadConfig({}, {})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      databaseUrl: "postgres://rostrum:rostrum@localhost:5432/rostrum",
      logLevel: "info",
    });
  });

  test("applies environment overrides", () => {
    const config = loadConfig(
      {
        HOST: "0.0.0.0",
        PORT: "8080",
        DATABASE_URL: "postgres://other:secret@db:5432/rostrum",
        LOG_LEVEL: "debug",
      },
      {},
    );
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
    expect(config.databaseUrl).toBe("postgres://other:secret@db:5432/rostrum");
    expect(config.logLevel).toBe("debug");
  });

  test("environment overrides the file layer per variable", () => {
    const config = loadConfig({ PORT: "8081" }, { port: 9090, host: "0.0.0.0" });
    expect(config.port).toBe(8081);
    expect(config.host).toBe("0.0.0.0");
  });

  test("falls back to the file layer when the variable is absent", () => {
    const config = loadConfig({}, { host: "0.0.0.0", port: 9090, logLevel: "debug" });
    expect(config).toEqual({
      host: "0.0.0.0",
      port: 9090,
      databaseUrl: "postgres://rostrum:rostrum@localhost:5432/rostrum",
      logLevel: "debug",
    });
  });

  test("reads YAML values from the config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "rostrum-env-"));
    const path = join(dir, "config.yaml");
    writeFileSync(path, "host: 0.0.0.0\nport: 9090\n");
    expect(readConfigLayer(path)).toEqual({ host: "0.0.0.0", port: 9090 });
  });

  test("treats a missing config file as an empty layer", () => {
    expect(readConfigLayer(join(tmpdir(), "does-not-exist.yaml"))).toEqual({});
  });

  test("rejects values that fail the config schema", () => {
    for (const bad of ["abc", "3.5", "-1", "70000"]) {
      expect(() => loadConfig({ PORT: bad }, {})).toThrow(/port/);
    }
    expect(() => loadConfig({ LOG_LEVEL: "verbose" }, {})).toThrow(/logLevel/);
  });

  test("accepts port 0 (ephemeral port for process tests)", () => {
    expect(loadConfig({ PORT: "0" }, {}).port).toBe(0);
  });
});
