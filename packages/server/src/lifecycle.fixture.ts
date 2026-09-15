/** @fileoverview Child-process fixture for lifecycle integration tests. */

import { readFileSync } from "node:fs";
import { getLogger } from "@logtape/logtape";
import { runService, type ServiceResources, type ServiceRuntimeConfig } from "./lifecycle";
import { ConfigurationError } from "./network";

/** Runs the real lifecycle with controlled configuration and handlers. */
interface FixtureConfig extends ServiceRuntimeConfig {
    /** Served by `/marker`, so a test can prove which configuration is serving. */
    marker: string;
    /** How long `/hold` stays outstanding. */
    holdMs: number;
    /** How many chunks `/stream` emits before closing. */
    streamChunks: number;
    /** How long `/stream` waits between chunks. */
    streamDelayMs: number;
}

const CONFIG_PATH = process.env.FIXTURE_CONFIG;
if (CONFIG_PATH === undefined) {
    throw new Error("FIXTURE_CONFIG is required");
}

/** Reads the startup configuration; the process reads this file exactly once. */
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
    const nodeEnv = source.nodeEnv;
    if (
        nodeEnv !== undefined &&
        nodeEnv !== "development" &&
        nodeEnv !== "test" &&
        nodeEnv !== "production"
    ) {
        throw new ConfigurationError("nodeEnv", "must be a known environment");
    }
    return {
        host: "127.0.0.1",
        port: typeof source.port === "number" ? source.port : 0,
        logLevel: "info",
        shutdownTimeoutMs:
            typeof source.shutdownTimeoutMs === "number" ? source.shutdownTimeoutMs : 5_000,
        marker: source.marker,
        holdMs: typeof source.holdMs === "number" ? source.holdMs : 0,
        streamChunks: typeof source.streamChunks === "number" ? source.streamChunks : 0,
        streamDelayMs: typeof source.streamDelayMs === "number" ? source.streamDelayMs : 0,
    };
}

interface FixtureResources extends ServiceResources {
    readonly id: number;
}

let created = 0;

/** Creates an identified resource so tests can observe closure order. */
async function createResources(): Promise<FixtureResources> {
    created += 1;
    const id = created;
    return {
        id,
        async close(): Promise<void> {
            getLogger("control-api").info("fixture dependency closed", { id });
        },
    };
}

/** Emits the configured number of chunks so a test can observe a live response body. */
function streamBody(config: FixtureConfig): ReadableStream<Uint8Array> {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (sent === config.streamChunks) {
                controller.close();
                return;
            }
            sent += 1;
            getLogger("control-api").info("fixture stream chunk", { sent });
            controller.enqueue(new TextEncoder().encode(`chunk-${sent}\n`));
            await Bun.sleep(config.streamDelayMs);
        },
    });
}

await runService<FixtureConfig, FixtureResources>({
    name: "control-api",
    loadConfig,
    createResources,
    fetch: async (request, config, resources) => {
        const url = new URL(request.url);
        if (url.pathname === "/marker") {
            return Response.json({ marker: config.marker, dependency: resources.id });
        }
        if (url.pathname === "/hold") {
            // Let tests synchronize after the request reaches the handler.
            getLogger("control-api").info("fixture hold started");
            await Bun.sleep(config.holdMs);
            return Response.json({ held: config.holdMs });
        }
        if (url.pathname === "/stream") {
            getLogger("control-api").info("fixture stream started");
            return new Response(streamBody(config), {
                headers: { "content-type": "text/plain" },
            });
        }
        return Response.json({ code: "not_found" }, { status: 404 });
    },
});
