/**
 * Shared transport contract for the E2-S2 proof of concept.
 *
 * This file stands in for the `packages/contracts` workspace package that
 * E2-03 will create. It carries the three envelope rules and the message
 * shapes in one place, and the daemon, the Control API stand-in, and this
 * harness all import from it, so no layer redefines the other's messages.
 *
 * Envelope rules (approved E2-S2 decision):
 * 1. Bodies are JSON (`application/json`); one request receives exactly one
 *    response; the HTTP status class carries the outcome.
 * 2. Request and response bodies belong to the executable-workflow contract
 *    (E2-03); the envelope adds no fields to them.
 * 3. An optional caller-supplied `x-request-id` header is logged and echoed
 *    by the daemon. It serves diagnosis only and never affects routing or
 *    acceptance.
 */

/** Optional caller-supplied header the daemon logs and echoes verbatim. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Media type of every request and response body in this transport. */
export const JSON_MEDIA_TYPE = "application/json";

/** Public run statuses from the E2-S1 decision; `stopping` never crosses. */
export const RUN_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Submission body: pass-by-identity. The daemon loads the document itself. */
export interface SubmissionBody {
    workflowId: string;
    workflowVersion: number;
    inputs: Record<string, unknown>;
}

/** One active step instance in the `currentSteps` projection. */
export interface CurrentStep {
    stepId: string;
    state: "ready" | "running";
}

/** One entry of a failed run's ordered `failures` array (E2-S1 shape). */
export interface FailureEntry {
    code: string;
    message: string;
    phase: string;
    stepId?: string;
    iteration?: number;
    path?: string;
    details?: Record<string, unknown>;
}

/** Run representation carried by submission and retrieval responses. */
export interface RunRepresentation {
    runId: string;
    workflowId: string;
    workflowVersion: number;
    status: RunStatus;
    currentSteps: CurrentStep[];
    output: Record<string, unknown> | null;
    failures: FailureEntry[];
}

/** Response of GET /api/v1/system/version on the daemon. */
export interface VersionInfo {
    service: string;
    version: string;
    interfaceVersion: string;
}

/** Response of GET /api/v1/system/health on the daemon. */
export interface HealthInfo {
    status: "ok";
}

/**
 * Structured invocation rejection body. The daemon mints it; the Control API
 * passes it through verbatim. Final schemas and codes are E2-03 decisions.
 */
export interface InvocationRejection {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

/**
 * Public error shape of the Control API (`apps/control-api/src/schemas.ts`).
 * Transport-level failures use this shape; they are Control API errors, not
 * daemon messages.
 */
export interface PublicError {
    code: string;
    message: string;
    findings: unknown[];
}

// Rejection codes fixed by the E2-S1 decision; the transport carries them
// verbatim and never rewrites them.
export const RUN_INPUT_MISSING = "run.input.missing";
export const RUN_INPUT_UNKNOWN = "run.input.unknown";
export const RUN_STEP_UNSUPPORTED = "run.step.unsupported";
export const RUN_WORKFLOW_NOT_FOUND = "run.invocation.workflow-not-found";

// Codes the approved E2-S2 mapping reserves for transport-level failures;
// the Control API mints these, the daemon never sees them.
export const DAEMON_UNAVAILABLE = "run.daemon.unavailable";
export const DAEMON_TIMEOUT = "run.daemon.timeout";
export const DAEMON_PROTOCOL = "run.daemon.protocol";

// Provisional codes whose final names E2-03 and E2-10 own. The proof uses
// them only where the mapping table requires a 404 pass-through or a
// route-level fallback; no scenario asserts their exact value.
export const RUN_NOT_FOUND = "run.not-found";
export const RUN_ROUTE_NOT_FOUND = "run.route-not-found";
export const RUN_INVOCATION_MALFORMED = "run.invocation.malformed";
export const RUN_DIGEST_MISMATCH = "run.invocation.digest-mismatch";

/** Builds a response with the envelope's JSON media type and optional echo. */
export function jsonResponse(status: number, body: unknown, requestId?: string): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": JSON_MEDIA_TYPE,
            ...(requestId === undefined ? {} : { [REQUEST_ID_HEADER]: requestId }),
        },
    });
}

/**
 * Builds a verbatim pass-through response from a raw daemon body. The
 * Control API rewrites nothing: same status, same bytes.
 */
export function forwardResponse(status: number, body: string): Response {
    return new Response(body, { status, headers: { "content-type": JSON_MEDIA_TYPE } });
}

/**
 * The one canonical structural guard of this contract module. Every message
 * guard below narrows with it; no call site recreates its own copy.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural guard standing in for the TypeBox check in packages/contracts. */
export function isSubmissionBody(value: unknown): value is SubmissionBody {
    return (
        isRecord(value) &&
        typeof value.workflowId === "string" &&
        value.workflowId.length > 0 &&
        typeof value.workflowVersion === "number" &&
        Number.isInteger(value.workflowVersion) &&
        value.workflowVersion >= 1 &&
        isRecord(value.inputs)
    );
}

/** Structural guard standing in for the TypeBox check in packages/contracts. */
export function isRunRepresentation(value: unknown): value is RunRepresentation {
    if (!isRecord(value)) return false;
    if (typeof value.runId !== "string" || value.runId.length === 0) return false;
    if (typeof value.workflowId !== "string" || value.workflowId.length === 0) return false;
    if (typeof value.workflowVersion !== "number" || !Number.isInteger(value.workflowVersion)) {
        return false;
    }
    if (!RUN_STATUSES.includes(value.status as RunStatus)) return false;
    if (!Array.isArray(value.currentSteps)) return false;
    for (const step of value.currentSteps) {
        if (!isRecord(step)) return false;
        if (typeof step.stepId !== "string") return false;
        if (step.state !== "ready" && step.state !== "running") return false;
    }
    if (value.output !== null && !isRecord(value.output)) return false;
    if (!Array.isArray(value.failures)) return false;
    for (const failure of value.failures) {
        if (!isRecord(failure)) return false;
        if (typeof failure.code !== "string") return false;
        if (typeof failure.message !== "string") return false;
        if (typeof failure.phase !== "string") return false;
    }
    return true;
}

/** Structural guard standing in for the TypeBox check in packages/contracts. */
export function isVersionInfo(value: unknown): value is VersionInfo {
    return (
        isRecord(value) &&
        typeof value.service === "string" &&
        typeof value.version === "string" &&
        typeof value.interfaceVersion === "string"
    );
}

/** Structural guard standing in for the TypeBox check in packages/contracts. */
export function isHealthInfo(value: unknown): value is HealthInfo {
    return isRecord(value) && value.status === "ok";
}
