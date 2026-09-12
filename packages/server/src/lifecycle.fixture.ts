import { readFileSync } from "node:fs";
import { type RuntimeConfig, runService, type ServiceDependencies } from "./lifecycle";
import { ConfigurationError } from "./network";

/**
 * Test-only entry point for the lifecycle and reload regression tests. It
 * drives the real `runService` runtime with a controlled handler, so the
 * tests exercise actual signal handling, draining, and reload cutover rather
 * than an in-process imitation. Not part of any service.
 */

interface FixtureConfig extends RuntimeConfig {
    /** Served by `/marker`, so a test can prove which snapshot answered. */
    marker: string;
    /** How long `/hold` stays outstanding. */
    holdMs: number;
}

const CONFIG_PATH = process.env.FIXTURE_CONFIG;
if (CONFIG_PATH === undefined) {
    throw new Error("FIXTURE_CONFIG is required");
}

/** Reads the candidate the test wrote; a malformed file is a rejected reload. */
function loadConfig(): FixtureConfig {
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(CONFIG_PATH as string, "utf8"));
    } catch {
        throw new ConfigurationError("fixture", "is not valid JSON");
    }
    if (typeof raw !== "object" || raw === null) {
        throw new ConfigurationError("fixture", "must be an object");
    }
    const source = raw as Record<string, unknown>;
    if (typeof source.marker !== "string" || source.marker.length === 0) {
        throw new ConfigurationError("marker", "is required");
    }
    return {
        host: "127.0.0.1",
        port: typeof source.port === "number" ? source.port : 0,
        logLevel: "info",
        nodeEnv: "test",
        databaseUrl: "postgres://fixture@127.0.0.1:1/fixture",
        databaseTlsMode: "disable",
        allowInsecureLocal: true,
        dependencyTimeoutMs: 2_000,
        shutdownTimeoutMs:
            typeof source.shutdownTimeoutMs === "number" ? source.shutdownTimeoutMs : 5_000,
        marker: source.marker,
        holdMs: typeof source.holdMs === "number" ? source.holdMs : 0,
    };
}

interface FixtureDependencies extends ServiceDependencies {
    readonly id: number;
}

let created = 0;

/** Each snapshot owns an identified resource, so closure order is observable. */
async function createDependencies(): Promise<FixtureDependencies> {
    created += 1;
    const id = created;
    return {
        id,
        async close(): Promise<void> {
            console.log(JSON.stringify({ msg: "fixture dependency closed", id }));
        },
    };
}

await runService<FixtureConfig, FixtureDependencies>({
    name: "control-api",
    loadConfig,
    createDependencies,
    readiness: async () => ({ status: "ready", checks: {} }),
    fetch: async (request, config, dependencies) => {
        const url = new URL(request.url);
        if (url.pathname === "/marker") {
            return Response.json({ marker: config.marker, dependency: dependencies.id });
        }
        if (url.pathname === "/hold") {
            // The tests await this line instead of guessing a duration, so they
            // never signal before the request has reached the handler.
            console.log(JSON.stringify({ msg: "fixture hold started" }));
            await Bun.sleep(config.holdMs);
            return Response.json({ held: config.holdMs });
        }
        return Response.json({ code: "not_found" }, { status: 404 });
    },
});
