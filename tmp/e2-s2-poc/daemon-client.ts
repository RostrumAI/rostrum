/**
 * The executable reference model of the approved E2-S2 decision: one client
 * wrapper, typed against a `fetch`-compatible function, that performs every
 * daemon call. The deadline, the correlation header, and the transport
 * classification live in exactly one place, so the same call code drives
 * in-process tests, real-process tests, and later conformance fixtures.
 *
 * The wrapper classifies outcomes; it never rewrites them. Invocation
 * rejections surface as `rejected` with the daemon's status and raw body,
 * and only the Control API turns transport failures into public errors.
 */

import {
    isHealthInfo,
    isRunRepresentation,
    isVersionInfo,
    JSON_MEDIA_TYPE,
    REQUEST_ID_HEADER,
    type HealthInfo,
    type RunRepresentation,
    type VersionInfo,
} from "./contract";

/** A `fetch`-compatible transport function. */
export type FetchLike = (request: Request) => Promise<Response>;

/**
 * Transport-level failure the wrapper classified. The approved mapping turns
 * these into `503 run.daemon.unavailable`, `504 run.daemon.timeout`, and
 * `500 run.daemon.protocol` at the Control API boundary.
 */
export type TransportFailure =
    | { kind: "unavailable"; detail: string }
    | { kind: "timeout"; detail: string }
    | { kind: "protocol"; detail: string };

export type SubmitOutcome =
    | { kind: "accepted"; run: RunRepresentation; raw: string }
    | { kind: "rejected"; status: number; body: string }
    | TransportFailure;

export type RetrieveOutcome =
    | { kind: "found"; run: RunRepresentation; raw: string }
    | { kind: "rejected"; status: number; body: string }
    | TransportFailure;

export type HealthOutcome = { kind: "ok"; health: HealthInfo } | TransportFailure;

export type VersionOutcome = { kind: "ok"; version: VersionInfo } | TransportFailure;

export interface DaemonClientOptions {
    /** Loopback base URL of the daemon, for example http://127.0.0.1:3100. */
    baseUrl: string;
    /** Explicit client deadline applied to every daemon call. */
    timeoutMs: number;
    /** Defaults to global `fetch`; the in-process harness injects app.fetch. */
    fetchImpl?: FetchLike;
}

export class DaemonClient {
    private readonly baseUrl: string;
    private readonly timeoutMs: number;
    private readonly fetchImpl: FetchLike;

    constructor(options: DaemonClientOptions) {
        this.baseUrl = options.baseUrl;
        this.timeoutMs = options.timeoutMs;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    async checkHealth(): Promise<HealthOutcome> {
        const sent = await this.send("GET", "/api/v1/system/health");
        if ("kind" in sent) return sent;
        if (!sent.response.ok) {
            return { kind: "protocol", detail: `health answered ${sent.response.status}` };
        }
        const parsed = await parseDaemonJson(sent.response, "health");
        if (parsed.kind !== "parsed") return parsed;
        if (!isHealthInfo(parsed.body)) {
            return { kind: "protocol", detail: "health body is not { status: \"ok\" }" };
        }
        return { kind: "ok", health: parsed.body };
    }

    async checkVersion(): Promise<VersionOutcome> {
        const sent = await this.send("GET", "/api/v1/system/version");
        if ("kind" in sent) return sent;
        if (!sent.response.ok) {
            return { kind: "protocol", detail: `version answered ${sent.response.status}` };
        }
        const parsed = await parseDaemonJson(sent.response, "version");
        if (parsed.kind !== "parsed") return parsed;
        if (!isVersionInfo(parsed.body)) {
            return { kind: "protocol", detail: "version body is not a version document" };
        }
        return { kind: "ok", version: parsed.body };
    }

    async submitRun(body: unknown): Promise<SubmitOutcome> {
        const sent = await this.send("POST", "/api/v1/runs", body);
        if ("kind" in sent) return sent;
        if (!sent.response.ok) {
            // Verbatim pass-through: same status, same bytes, no rewriting.
            return { kind: "rejected", status: sent.response.status, body: await sent.response.text() };
        }
        const parsed = await parseDaemonJson(sent.response, "submission");
        if (parsed.kind !== "parsed") return parsed;
        if (!isRunRepresentation(parsed.body)) {
            return { kind: "protocol", detail: "submission response is not a run representation" };
        }
        return { kind: "accepted", run: parsed.body, raw: parsed.text };
    }

    async retrieveRun(runId: string): Promise<RetrieveOutcome> {
        const sent = await this.send("GET", `/api/v1/runs/${encodeURIComponent(runId)}`);
        if ("kind" in sent) return sent;
        if (!sent.response.ok) {
            // The approved mapping passes the daemon's 404 for an unknown run
            // through verbatim; the Control API forwards status and body.
            return { kind: "rejected", status: sent.response.status, body: await sent.response.text() };
        }
        const parsed = await parseDaemonJson(sent.response, "retrieval");
        if (parsed.kind !== "parsed") return parsed;
        if (!isRunRepresentation(parsed.body)) {
            return { kind: "protocol", detail: "retrieval response is not a run representation" };
        }
        return { kind: "found", run: parsed.body, raw: parsed.text };
    }

    private async send(
        method: string,
        path: string,
        body?: unknown,
    ): Promise<{ response: Response } | TransportFailure> {
        const requestId = crypto.randomUUID();
        const headers: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };
        if (body !== undefined) headers["content-type"] = JSON_MEDIA_TYPE;
        const request = new Request(`${this.baseUrl}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        let response: Response;
        try {
            response = await this.fetchImpl(request);
        } catch (error) {
            return classifyTransportError(error, this.timeoutMs);
        }
        // Envelope rule 3: the daemon echoes the caller-supplied request id.
        const echoed = response.headers.get(REQUEST_ID_HEADER);
        if (echoed !== requestId) {
            return {
                kind: "protocol",
                detail: `x-request-id echo mismatch: sent ${requestId}, received ${String(echoed)}`,
            };
        }
        return { response };
    }
}

/**
 * Classifies a thrown call by observation: a deadline expiry is a timeout,
 * every other transport-level throw is unavailability. The probe on Bun
 * records `TimeoutError` for expiry and `ConnectionRefused` for refusal.
 */
function classifyTransportError(error: unknown, timeoutMs: number): TransportFailure {
    const err = error as Error & { code?: string };
    if (err.name === "TimeoutError" || err.name === "AbortError") {
        return { kind: "timeout", detail: `no response within ${timeoutMs} ms` };
    }
    return { kind: "unavailable", detail: `${err.name}: ${err.message}` };
}

type ParsedDaemonJson = { kind: "parsed"; body: unknown; text: string } | TransportFailure;

async function parseDaemonJson(
    response: Response,
    operation: string,
): Promise<ParsedDaemonJson> {
    const text = await response.text();
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        return { kind: "protocol", detail: `${operation} response body is not JSON` };
    }
    return { kind: "parsed", body, text };
}
