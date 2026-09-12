import { afterEach, describe, expect, test } from "bun:test";
import type { ControlApiConfig } from "@rostrum/server/config";
import { checkDaemonReadiness } from "./client";

/** A daemon-shaped configuration; only the daemon link fields matter here. */
function config(daemonUrl: string, tokens: readonly string[]): ControlApiConfig {
    return {
        host: "127.0.0.1",
        port: 3000,
        nodeEnv: "test",
        logLevel: "info",
        databaseUrl: "postgres://rostrum:rostrum@127.0.0.1:5432/rostrum",
        databaseTlsMode: "disable",
        allowInsecureLocal: true,
        tokens,
        dependencyTimeoutMs: 2_000,
        shutdownTimeoutMs: 30_000,
        daemonUrl,
    };
}

const READY = { status: "ready", checks: { database: { status: "ok" } } };

/**
 * Starts a server that answers with one canned response. Request headers are
 * snapshotted while handling, because the server recycles the `Request` object
 * after the handler returns.
 */
function responder(handler: (request: Request) => Response): {
    origin: string;
    requests: Array<{ authorization: string | null }>;
    stop: () => void;
} {
    const requests: Array<{ authorization: string | null }> = [];
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) => {
            requests.push({ authorization: request.headers.get("authorization") });
            return handler(request);
        },
    });
    return {
        origin: `http://127.0.0.1:${server.port}`,
        requests,
        stop: () => server.stop(true),
    };
}

const stoppables: Array<() => void> = [];
function track(stop: () => void): void {
    stoppables.push(stop);
}
afterEach(() => {
    while (stoppables.length > 0) stoppables.pop()?.();
});

describe("daemon readiness client", () => {
    test("does not route through an ambient forward proxy", async () => {
        const target = responder(() => Response.json(READY));
        track(target.stop);
        const proxy = responder(() => Response.json({ reached: "proxy" }));
        track(proxy.stop);

        // A forward proxy in the environment must never receive the probe, and
        // therefore never the bearer token.
        const saved = {
            HTTP_PROXY: process.env.HTTP_PROXY,
            HTTPS_PROXY: process.env.HTTPS_PROXY,
            http_proxy: process.env.http_proxy,
            https_proxy: process.env.https_proxy,
        };
        process.env.HTTP_PROXY = proxy.origin;
        process.env.HTTPS_PROXY = proxy.origin;
        process.env.http_proxy = proxy.origin;
        process.env.https_proxy = proxy.origin;
        try {
            const result = await checkDaemonReadiness(
                config(target.origin, ["a".repeat(64)]),
                new AbortController().signal,
            );
            expect(result).toEqual({ status: "ok" });
            expect(proxy.requests).toHaveLength(0);
            expect(target.requests).toHaveLength(1);
        } finally {
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    test("sends only the newest token, as a bearer credential", async () => {
        const oldest = "1".repeat(64);
        const newest = "2".repeat(64);
        const target = responder(() => Response.json(READY));
        track(target.stop);

        await checkDaemonReadiness(
            config(target.origin, [oldest, newest]),
            new AbortController().signal,
        );

        expect(target.requests[0]?.authorization).toBe(`Bearer ${newest}`);
    });

    test("classifies rejection, non-JSON, oversize, not-ready, and refusal distinctly", async () => {
        const unauthorized = responder(() => new Response("no", { status: 401 }));
        const notJson = responder(() => new Response("<html>", { status: 200 }));
        const oversized = responder(() => new Response("x".repeat(80 * 1024), { status: 200 }));
        const notReady = responder(() =>
            Response.json(
                {
                    status: "not_ready",
                    checks: { database: { status: "failed", code: "database_unavailable" } },
                },
                { status: 503 },
            ),
        );
        for (const server of [unauthorized, notJson, oversized, notReady]) track(server.stop);
        const signal = new AbortController().signal;

        expect(
            await checkDaemonReadiness(config(unauthorized.origin, ["a".repeat(64)]), signal),
        ).toEqual({ status: "failed", code: "daemon_unauthorized" });
        expect(
            await checkDaemonReadiness(config(notJson.origin, ["a".repeat(64)]), signal),
        ).toEqual({ status: "failed", code: "daemon_invalid_response" });
        expect(
            await checkDaemonReadiness(config(oversized.origin, ["a".repeat(64)]), signal),
        ).toEqual({ status: "failed", code: "daemon_invalid_response" });
        expect(
            await checkDaemonReadiness(config(notReady.origin, ["a".repeat(64)]), signal),
        ).toEqual({ status: "failed", code: "daemon_not_ready" });
    });

    test("reports an unavailable daemon without retrying", async () => {
        // Bind and release a port so nothing is listening on it.
        const spare = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
        const port = spare.port;
        spare.stop(true);

        const result = await checkDaemonReadiness(
            config(`http://127.0.0.1:${port}`, ["a".repeat(64)]),
            new AbortController().signal,
        );
        expect(result).toEqual({ status: "failed", code: "daemon_unavailable" });
    });

    test("reports unauthorized when no token is configured", async () => {
        const result = await checkDaemonReadiness(
            config("http://127.0.0.1:1", []),
            new AbortController().signal,
        );
        expect(result).toEqual({ status: "failed", code: "daemon_unauthorized" });
    });
});
