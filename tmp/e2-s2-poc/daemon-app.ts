/**
 * The daemon application for the E2-S2 proof of concept.
 *
 * `createDaemonApp` returns a `fetch`-compatible handler, so the same
 * application serves real process traffic through `Bun.serve` (daemon.ts)
 * and in-process calls through `app.fetch` (the harness). That duality is
 * the endpoint-independence property the approved decision relies on.
 *
 * The executor is a deliberate stub: a seeded published version and two
 * timed transitions produce the `queued` -> `running` -> `succeeded`
 * progression the retrieval scenarios observe. Workflow execution itself
 * belongs to E2-07 through E2-09 and is out of scope here.
 */

import {
    isSubmissionBody,
    jsonResponse,
    REQUEST_ID_HEADER,
    RUN_DIGEST_MISMATCH,
    RUN_INPUT_MISSING,
    RUN_INPUT_UNKNOWN,
    RUN_INVOCATION_MALFORMED,
    RUN_NOT_FOUND,
    RUN_ROUTE_NOT_FOUND,
    RUN_STEP_UNSUPPORTED,
    RUN_WORKFLOW_NOT_FOUND,
    type CurrentStep,
    type FailureEntry,
    type InvocationRejection,
    type RunRepresentation,
    type RunStatus,
    type SubmissionBody,
    type VersionInfo,
} from "./contract";
import { log } from "./log";

/** The workflow interface version this daemon can execute (E1-S1 exact match). */
const INTERFACE_VERSION = "v1";

/** Service identity reported by GET /api/v1/system/version. */
const VERSION_INFO: VersionInfo = {
    service: "rostrum-daemon",
    version: "0.0.0-poc",
    interfaceVersion: INTERFACE_VERSION,
};

/** Executor timeline: the step goes `running` first, then the run terminal. */
const STEP_RUNNING_AT_MS = 150;
const RUN_SUCCEEDS_AT_MS = 450;

/** Fault modes the harness uses to exercise timeout and protocol mapping. */
export type DaemonFault = "hang-submission" | "malformed-submission";

export interface DaemonAppConfig {
    /** Harness-only fault injection; never part of the transport contract. */
    faults?: DaemonFault;
}

/** One immutable published version in the daemon's in-memory store. */
interface PublishedVersion {
    workflowId: string;
    version: number;
    /** Canonical document text; the digest is taken over exactly this text. */
    canonical: string;
    /** SHA-256 lowercase hex of the canonical text (E1-S3). */
    digest: string;
    requiredInputNames: string[];
    knownInputNames: string[];
    stepTypes: string[];
    output: Record<string, unknown>;
}

/** Mutable in-memory run state; the E2-S1 reducer stands in as a timeline. */
interface DaemonRun {
    runId: string;
    workflowId: string;
    workflowVersion: number;
    status: RunStatus;
    currentSteps: CurrentStep[];
    output: Record<string, unknown> | null;
    failures: FailureEntry[];
}

/** Step types with a registered handler in this proof. */
const REGISTERED_STEP_TYPES: readonly string[] = ["greet"];

function sha256Hex(text: string): string {
    return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function publishedKey(workflowId: string, version: number): string {
    return `${workflowId}@${version}`;
}

function seedPublishedVersions(): Map<string, PublishedVersion> {
    // The example workflow and version match the approved research document.
    // RFC 8785 canonicalization is out of scope; plain JSON.stringify text
    // stands in for the canonical form the digest is taken over.
    const workflowId = "0198c7a1-7d2a-7cc2-9a31-3f9a2d7e8b10";
    const canonical = JSON.stringify({
        id: workflowId,
        version: 3,
        inputs: { name: { type: "string" } },
        steps: [{ id: "greet", type: "greet", inputs: { name: "inputs.name" } }],
        result: { message: "greet.message" },
    });
    const published: PublishedVersion = {
        workflowId,
        version: 3,
        canonical,
        digest: sha256Hex(canonical),
        requiredInputNames: ["name"],
        knownInputNames: ["name"],
        stepTypes: ["greet"],
        output: { message: "Hello, Ada" },
    };
    return new Map([[publishedKey(published.workflowId, published.version), published]]);
}

export interface DaemonApp {
    /** The complete daemon surface as a fetch-compatible handler. */
    fetch: (request: Request) => Promise<Response>;
    /** Registered shutdown handler: discards pending executor timers. */
    close: () => void;
}

export function createDaemonApp(config: DaemonAppConfig = {}): DaemonApp {
    const published = seedPublishedVersions();
    const runs = new Map<string, DaemonRun>();
    const timers = new Set<Timer>();

    function scheduleRun(run: DaemonRun, version: PublishedVersion): void {
        const startTimer = setTimeout(() => {
            timers.delete(startTimer);
            run.status = "running";
            run.currentSteps = [{ stepId: "greet", state: "running" }];
        }, STEP_RUNNING_AT_MS);
        timers.add(startTimer);
        const doneTimer = setTimeout(() => {
            timers.delete(doneTimer);
            run.status = "succeeded";
            run.currentSteps = [];
            run.output = { ...version.output };
        }, RUN_SUCCEEDS_AT_MS);
        timers.add(doneTimer);
    }

    function represent(run: DaemonRun): RunRepresentation {
        return {
            runId: run.runId,
            workflowId: run.workflowId,
            workflowVersion: run.workflowVersion,
            status: run.status,
            currentSteps: run.currentSteps.map((step) => ({ ...step })),
            output: run.output === null ? null : { ...run.output },
            failures: run.failures.map((failure) => ({ ...failure })),
        };
    }

    function rejection(
        code: string,
        message: string,
        details?: Record<string, unknown>,
    ): InvocationRejection {
        return details === undefined ? { code, message } : { code, message, details };
    }

    async function submit(request: Request, requestId: string | undefined): Promise<Response> {
        let parsedBody: unknown;
        try {
            parsedBody = await request.json();
        } catch {
            return jsonResponse(
                400,
                rejection(RUN_INVOCATION_MALFORMED, "The request body is not valid JSON."),
                requestId,
            );
        }
        if (!isSubmissionBody(parsedBody)) {
            return jsonResponse(
                400,
                rejection(
                    RUN_INVOCATION_MALFORMED,
                    "The request body is not a well-formed invocation.",
                ),
                requestId,
            );
        }
        const body: SubmissionBody = parsedBody;

        // Pass-by-identity: load the exact published version, then verify it,
        // before any acceptance check can create a run.
        const version = published.get(publishedKey(body.workflowId, body.workflowVersion));
        if (version === undefined) {
            return jsonResponse(
                404,
                rejection(
                    RUN_WORKFLOW_NOT_FOUND,
                    `Published version ${body.workflowVersion} of workflow '${body.workflowId}' does not exist.`,
                ),
                requestId,
            );
        }
        const digest = sha256Hex(version.canonical);
        if (digest !== version.digest) {
            // Unreachable while the store is in memory; kept so the proof
            // exercises the verification step the decision requires.
            return jsonResponse(
                500,
                rejection(
                    RUN_DIGEST_MISMATCH,
                    "The stored document does not match its published digest.",
                ),
                requestId,
            );
        }
        log("debug", "digest verified", {
            workflowId: body.workflowId,
            workflowVersion: body.workflowVersion,
        });

        const missing = version.requiredInputNames.filter((name) => !(name in body.inputs));
        if (missing.length > 0) {
            return jsonResponse(
                400,
                rejection(
                    RUN_INPUT_MISSING,
                    "The invocation is missing required workflow inputs.",
                    { missing },
                ),
                requestId,
            );
        }
        const unknownInputs = Object.keys(body.inputs).filter(
            (name) => !version.knownInputNames.includes(name),
        );
        if (unknownInputs.length > 0) {
            return jsonResponse(
                400,
                rejection(
                    RUN_INPUT_UNKNOWN,
                    "The invocation declares inputs the workflow does not define.",
                    { unknown: unknownInputs },
                ),
                requestId,
            );
        }
        const unsupported = version.stepTypes.filter((type) => !REGISTERED_STEP_TYPES.includes(type));
        if (unsupported.length > 0) {
            return jsonResponse(
                400,
                rejection(
                    RUN_STEP_UNSUPPORTED,
                    "The workflow uses step types this daemon cannot execute.",
                    { unsupported },
                ),
                requestId,
            );
        }

        const run: DaemonRun = {
            runId: crypto.randomUUID(),
            workflowId: body.workflowId,
            workflowVersion: body.workflowVersion,
            status: "queued",
            currentSteps: [],
            output: null,
            failures: [],
        };
        runs.set(run.runId, run);
        scheduleRun(run, version);
        log("info", "run accepted", {
            runId: run.runId,
            workflowId: run.workflowId,
            workflowVersion: run.workflowVersion,
            requestId,
        });

        if (config.faults === "hang-submission") {
            // The run is accepted but the response never arrives, so the
            // caller's deadline decides the outcome and the accepted runId
            // exists only in this process's log.
            await new Promise<never>(() => {});
        }
        if (config.faults === "malformed-submission") {
            // A 201 whose body violates the run representation, to prove the
            // client classifies malformed daemon responses as protocol errors.
            return jsonResponse(201, { status: "queued" }, requestId);
        }
        return jsonResponse(201, represent(run), requestId);
    }

    function retrieve(runId: string, requestId: string | undefined): Response {
        const run = runs.get(runId);
        if (run === undefined) {
            // The approved mapping passes the daemon's 404 through verbatim;
            // E2-03 and E2-10 own the final public code for unknown runs.
            return jsonResponse(404, rejection(RUN_NOT_FOUND, `Unknown run '${runId}'.`), requestId);
        }
        return jsonResponse(200, represent(run), requestId);
    }

    async function handle(request: Request, requestId: string | undefined): Promise<Response> {
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path === "/api/v1/system/health") {
            return jsonResponse(200, { status: "ok" }, requestId);
        }
        if (request.method === "GET" && path === "/api/v1/system/version") {
            return jsonResponse(200, VERSION_INFO, requestId);
        }
        if (request.method === "POST" && path === "/api/v1/runs") {
            return submit(request, requestId);
        }
        const runMatch = /^\/api\/v1\/runs\/([^/]+)$/.exec(path);
        if (request.method === "GET" && runMatch) {
            return retrieve(decodeURIComponent(runMatch[1] as string), requestId);
        }
        return jsonResponse(
            404,
            rejection(RUN_ROUTE_NOT_FOUND, `No daemon route serves ${request.method} ${path}.`),
            requestId,
        );
    }

    const fetch = async (request: Request): Promise<Response> => {
        const requestId = request.headers.get(REQUEST_ID_HEADER) ?? undefined;
        const response = await handle(request, requestId);
        log("info", "request", {
            method: request.method,
            path: new URL(request.url).pathname,
            status: response.status,
            requestId,
        });
        return response;
    };

    const close = (): void => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
    };

    return { fetch, close };
}
