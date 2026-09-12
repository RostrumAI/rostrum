import type { ControlApiConfig } from "@rostrum/server/config";
import { type CheckResult, DaemonReadinessSchema } from "@rostrum/server/protocol";
import { Value } from "typebox/value";

/** Probe responses are small; anything larger is not a readiness body. */
const MAX_PROBE_BYTES = 64 * 1024;

/** Reads a response body up to the probe limit, refusing anything larger. */
async function readBounded(response: Response): Promise<string | undefined> {
    const body = response.body;
    if (body === null) return "";
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_PROBE_BYTES) {
                await reader.cancel();
                return undefined;
            }
            text += decoder.decode(value, { stream: true });
        }
    } finally {
        reader.releaseLock();
    }
    return text + decoder.decode();
}

/** Classifies a transport failure into the stable daemon check codes. */
function classifyFetchFailure(error: unknown): CheckResult {
    const message = error instanceof Error ? error.message : String(error);
    if (/certificate|self.signed|altname|SSL|TLS/i.test(message)) {
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
 * Uses only the configured origin and a fixed operation path, refuses
 * redirects, keeps certificate-chain and hostname verification on (extra trust
 * comes from `NODE_EXTRA_CA_CERTS`, never a per-client CA), bounds the response
 * it will read, and never forwards caller headers or retries with another
 * token.
 */
export async function checkDaemonReadiness(
    config: ControlApiConfig,
    signal: AbortSignal,
): Promise<CheckResult> {
    // Only the newest token is ever sent; older tokens are never a fallback.
    const token = config.tokens.at(-1);
    if (token === undefined) return { status: "failed", code: "daemon_unauthorized" };

    let response: Response;
    try {
        response = await fetch(new URL("/api/system/readiness", config.daemonUrl), {
            method: "GET",
            headers: { authorization: `Bearer ${token}`, accept: "application/json" },
            redirect: "error",
            signal,
            // Do not inherit ambient HTTP_PROXY/HTTPS_PROXY: a loopback
            // exception must not leak the bearer token through a forward proxy.
            proxy: undefined,
        });
    } catch (error) {
        if (signal.aborted) return { status: "failed", code: "daemon_timeout" };
        return classifyFetchFailure(error);
    }

    if (response.status === 401 || response.status === 403) {
        return { status: "failed", code: "daemon_unauthorized" };
    }

    const text = await readBounded(response).catch(() => undefined);
    if (text === undefined) return { status: "failed", code: "daemon_invalid_response" };

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
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
    if (response.status !== 200 && response.status !== 503) {
        return { status: "failed", code: "daemon_invalid_response" };
    }
    if (parsed.status === "ready") {
        return response.status === 200
            ? { status: "ok" }
            : { status: "failed", code: "daemon_invalid_response" };
    }
    return { status: "failed", code: "daemon_not_ready" };
}
