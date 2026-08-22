import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

/**
 * Boots the real Control API process over HTTP and runs the foundation
 * assertions. No database is required: E1-02 has no storage (E1-07 adds it).
 */
interface BootedServer {
  baseUrl: string;
  proc: ReturnType<typeof Bun.spawn>;
  output: string[];
  /** Resolves when the process stdout closes (after exit). */
  drained: Promise<void>;
}

async function bootServer(): Promise<BootedServer> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, PORT: "0", LOG_LEVEL: "info" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output: string[] = [];
  let port: number | undefined;
  const deadline = Date.now() + 15_000;
  const reader = proc.stdout.getReader();
  const errReader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  const feed = (chunk: Uint8Array, prefix: string) => {
    for (const line of decoder.decode(chunk).split("\n")) {
      if (!line) continue;
      output.push(`${prefix}${line}`);
      if (prefix) continue;
      try {
        const entry = JSON.parse(line) as { msg?: string; port?: number };
        if (entry.msg === "listening" && typeof entry.port === "number") port = entry.port;
      } catch {
        // non-JSON stdout line
      }
    }
  };
  void (async () => {
    try {
      while (true) {
        const { value, done } = await errReader.read();
        if (done) break;
        feed(value, "stderr: ");
      }
    } catch {
      // stream already closed
    }
  })();
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    feed(value, "");
    if (port !== undefined) break;
  }
  if (port === undefined) {
    await proc.kill();
    throw new Error(`server did not report a listening port; output: ${output.join("\n")}`);
  }
  // Keep draining stdout so post-listen logs (e.g. shutdown) are captured.
  const drained = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(value, "");
      }
    } catch {
      // stream already closed
    }
  })();
  return { baseUrl: `http://127.0.0.1:${port}`, proc, output, drained };
}

let server: BootedServer;

// Bun on Windows hard-terminates child processes for SIGTERM/SIGINT without
// delivering the JS signal event (verified on Bun 1.3.14); the graceful-
// shutdown assertions run on POSIX, where CI (ubuntu-latest) exercises them.
const signalTestSupported = process.platform !== "win32";

beforeAll(async () => {
  server = await bootServer();
});

afterAll(async () => {
  if (server?.proc) {
    server.proc.kill("SIGTERM");
    const exited = await server.proc.exited.catch(() => undefined);
    if (signalTestSupported && exited !== 0) {
      throw new Error(`server exited with ${exited}`);
    }
  }
});

describe("real process over HTTP", () => {
  test("boots through the normal path and foundation routes answer over HTTP", async () => {
    const health = await fetch(`${server.baseUrl}/api/v1/system/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const version = await fetch(`${server.baseUrl}/api/v1/system/version`);
    expect(version.status).toBe(200);
    const versionBody = (await version.json()) as Record<string, unknown>;
    expect(versionBody.service).toBe(pkg.name);
    expect(versionBody.interfaceVersion).toBe("v1");

    const missing = await fetch(`${server.baseUrl}/api/v1/nope`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe("not_found");

    const doc = await fetch(`${server.baseUrl}/openapi.json`);
    expect(doc.status).toBe(200);
    expect(((await doc.json()) as { openapi: string }).openapi).toBe("3.1.0");
  });

  test.skipIf(!signalTestSupported)("graceful shutdown on SIGTERM logs and exits 0", async () => {
    // Boot a second server so the shared one keeps serving the suite.
    const second = await bootServer();
    const health = await fetch(`${second.baseUrl}/api/v1/system/health`);
    expect(health.status).toBe(200);

    second.proc.kill("SIGTERM");
    const exitCode = await second.proc.exited;
    expect(exitCode).toBe(0);
    await second.drained;
    const shutdownLines = second.output.filter((line) => line.includes("shutdown"));
    expect(shutdownLines.some((line) => line.includes("shutdown started"))).toBe(true);
    expect(shutdownLines.some((line) => line.includes("shutdown complete"))).toBe(true);
  });
});
