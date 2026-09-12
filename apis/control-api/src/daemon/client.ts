import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ControlApiConfig } from "@rostrum/server/config";
import { type CheckResult, DaemonReadinessSchema } from "@rostrum/server/protocol";
import { Value } from "typebox/value";

/** Probe responses are small; anything larger is not a readiness body. */
const MAX_PROBE_BYTES = 64 * 1024;

interface ProbeResponse {
    readonly status: number;
    /** Undefined when the body exceeded the probe limit. */
    readonly body: string | undefined;
}

/**
 * Sends one readiness request over `node:http`/`node:https`.
 *
 * These clients never consult `HTTP_PROXY`/`HTTPS_PROXY`, which `fetch` does by
 * default and offers no way to opt out of, so an ambient forward proxy cannot
 * receive the bearer token. TLS uses the runtime's default trust, which includes
 * `NODE_EXTRA_CA_CERTS`, with certificate and hostname verification left on.
 */
function sendProbe(origin: URL, token: string, signal: AbortSignal): Promise<ProbeResponse> {
    const secure = origin.protocol === "https:";
    const { promise, resolve, reject } = Promise.withResolvers<ProbeResponse>();
    const request = (secure ? httpsRequest : httpRequest)(
        {
            protocol: origin.protocol,
            hostname: origin.hostname,
            port: origin.port === "" ? (secure ? 443 : 80) : Number(origin.port),
            // The origin is validated to have no path, query, or fragment.
            path: "/api/system/readiness",
            method: "GET",
            headers: { authorization: `Bearer ${token}`, accept: "application/json" },
            signal,
        },
        (response) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on("data", (chunk: Buffer) => {
                bytes += chunk.byteLength;
                if (bytes > MAX_PROBE_BYTES) {
                    response.destroy();
                    resolve({ status: response.statusCode ?? 0, body: undefined });
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", () => {
                resolve({
                    status: response.statusCode ?? 0,
                    body: Buffer.concat(chunks).toString("utf8"),
                });
            });
            response.on("error", reject);
        },
    );
    request.on("error", reject);
    request.end();
    return promise;
}

/** Classifies a transport failure into the stable daemon check codes. */
function classifyTransportFailure(error: unknown, signal: AbortSignal): CheckResult {
    const message = error instanceof Error ? error.message : String(error);
    if (signal.aborted) {
        return { status: "failed", code: "daemon_timeout" };
    }
    if (/certificate|self.signed|altname|SSL|TLS|CERT_/i.test(message)) {
        return { status: "failed", code: "daemon_tls_error" };
    }
    if (error instanceof Error && error.name === "AbortError") {
        return { status: "failed", code: "daemon_timeout" };
    }
    return { status: "failed", code: "daemon_unavailable" };
}

/**
 * Checks the daemon's authenticated readiness.
 *
 * Sends only the newest configured token, never forwards caller headers,
 * never retries or falls back to an older token, refuses redirects by never
 * following them, and bounds the response it will read.
 */
export async function checkDaemonReadiness(
    config: ControlApiConfig,
    signal: AbortSignal,
): Promise<CheckResult> {
    // Only the newest token is ever sent; older tokens are never a fallback.
    const token = config.tokens.at(-1);
    if (token === undefined) {
        return { status: "failed", code: "daemon_unauthorized" };
    }

    let response: ProbeResponse;
    try {
        response = await sendProbe(new URL(config.daemonUrl), token, signal);
    } catch (error) {
        return classifyTransportFailure(error, signal);
    }

    if (response.status === 401 || response.status === 403) {
        return { status: "failed", code: "daemon_unauthorized" };
    }
    if (response.status !== 200 && response.status !== 503) {
        return { status: "failed", code: "daemon_invalid_response" };
    }
    if (response.body === undefined) {
        return { status: "failed", code: "daemon_invalid_response" };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(response.body);
    } catch {
        return { status: "failed", code: "daemon_invalid_response" };
    }

    // A draining daemon answers the boundary error, not a readiness body.
    if (
        typeof parsed === "object" &&
        parsed !== null &&
        "code" in parsed &&
        parsed.code === "service_draining"
    ) {
        return { status: "failed", code: "daemon_not_ready" };
    }

    if (!Value.Check(DaemonReadinessSchema, parsed)) {
        return { status: "failed", code: "daemon_invalid_response" };
    }
    if (parsed.status === "ready") {
        return response.status === 200
            ? { status: "ok" }
            : { status: "failed", code: "daemon_invalid_response" };
    }
    return { status: "failed", code: "daemon_not_ready" };
}
