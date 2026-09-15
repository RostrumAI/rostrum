/** @fileoverview Child-process fixture for lifecycle integration tests. */

import { getLogger } from "@logtape/logtape";
import { Type } from "typebox";
import { defineConfig } from "./config";
import { boot, type ServiceRuntimeConfig } from "./lifecycle";

/** Runs the real runtime with a controlled configuration and handlers. */
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

const fixtureConfig = defineConfig<FixtureConfig>({
    schema: Type.Object(
        {
            host: Type.String({ minLength: 1 }),
            port: Type.Integer({ minimum: 0, maximum: 65535 }),
            logLevel: Type.Union(
                ["trace", "debug", "info", "warning", "error", "fatal"].map((level) =>
                    Type.Literal(level),
                ),
            ),
            shutdownTimeoutMs: Type.Integer({ minimum: 1, maximum: 300000 }),
            marker: Type.String({ minLength: 1 }),
            holdMs: Type.Integer({ minimum: 0 }),
            streamChunks: Type.Integer({ minimum: 0 }),
            streamDelayMs: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
    ),
    defaults: () => ({
        host: "127.0.0.1",
        port: 0,
        logLevel: "info",
        shutdownTimeoutMs: 5000,
        holdMs: 0,
        streamChunks: 0,
        streamDelayMs: 0,
    }),
    environment: {
        host: { name: "FIXTURE_HOST", kind: "string" },
        port: { name: "FIXTURE_PORT", kind: "integer" },
    },
    fileSelector: "FIXTURE_CONFIG",
    defaultFile: "config.json",
    finalize: (settings) => ({
        host: settings.host as string,
        port: settings.port as number,
        logLevel: settings.logLevel as FixtureConfig["logLevel"],
        shutdownTimeoutMs: settings.shutdownTimeoutMs as number,
        marker: settings.marker as string,
        holdMs: settings.holdMs as number,
        streamChunks: settings.streamChunks as number,
        streamDelayMs: settings.streamDelayMs as number,
    }),
});

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

let created = 0;

await boot(import.meta.dir, fixtureConfig, async (config) => {
    // Identify this process's resources so a test can observe their closure.
    created += 1;
    const id = created;

    return {
        fetch: async (request) => {
            const url = new URL(request.url);
            if (url.pathname === "/marker") {
                return Response.json({ marker: config.marker, dependency: id });
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
        close: async () => {
            getLogger("control-api").info("fixture dependency closed", { id });
        },
    };
});
