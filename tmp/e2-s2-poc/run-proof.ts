/**
 * Proof harness for the E2-S2 transport decision.
 *
 * It starts the daemon and the Control API boundary as real, separate
 * processes on loopback TCP and drives them through the same client wrapper
 * the Control API uses, then adds one in-process cell that drives the daemon
 * application without a socket. Every assertion prints one JSON line and the
 * final summary; the process exits nonzero if any check fails.
 *
 * Run from the repository root:
 *
 *     bun run tmp/e2-s2-poc/run-proof.ts
 */

import {
    DAEMON_PROTOCOL,
    DAEMON_TIMEOUT,
    DAEMON_UNAVAILABLE,
    isRunRepresentation,
    isVersionInfo,
    JSON_MEDIA_TYPE,
    REQUEST_ID_HEADER,
    RUN_INPUT_MISSING,
    RUN_WORKFLOW_NOT_FOUND,
    type PublicError,
    type RunRepresentation,
    type SubmissionBody,
} from "./contract";
import { createDaemonApp } from "./daemon-app";
import { ControlApiApp } from "./control-api";

/** The seeded example matches the approved research document. */
const WORKFLOW_ID = "0198c7a1-7d2a-7cc2-9a31-3f9a2d7e8b10";
const WORKFLOW_VERSION = 3;
const EXPECTED_OUTPUT_MESSAGE = "Hello, Ada";

const DAEMON_PORT = "3190";
const API_PORT = "3180";
const HUNG_DAEMON_PORT = "3191";
const HUNG_API_PORT = "3181";
const UNAVAILABLE_DAEMON_URL = "http://127.0.0.1:3199";
const UNAVAILABLE_API_PORT = "3182";
const MALFORMED_DAEMON_PORT = "3192";
const MALFORMED_API_PORT = "3183";
const SHUTDOWN_DAEMON_PORT = "3193";
const ECHO_REQUEST_ID = "poc-e2s2-echo-1";
const UNKNOWN_RUN_ID = "01980000-0000-7000-8000-000000000000";

const results: { scenario: string; ok: boolean; observed?: unknown }[] = [];

function check(scenario: string, ok: boolean, observed?: unknown): void {
    results.push({ scenario, ok, ...(ok ? {} : { observed }) });
    console.log(JSON.stringify({ scenario, ok, ...(ok ? {} : { observed }) }));
}

function submission(): SubmissionBody {
    return { workflowId: WORKFLOW_ID, workflowVersion: WORKFLOW_VERSION, inputs: { name: "Ada" } };
}

interface CapturedStream {
    text: () => string;
}

function captureStream(stream: ReadableStream<Uint8Array>): CapturedStream {
    let text = "";
    void (async () => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
    })();
    return { text: () => text };
}

interface SpawnedChild {
    proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
    out: CapturedStream;
    err: CapturedStream;
    port: string;
}

const children: SpawnedChild[] = [];

function spawnChild(script: string, port: string, extraEnv: Record<string, string>): SpawnedChild {
    const proc = Bun.spawn(["bun", "run", script], {
        cwd: import.meta.dir,
        env: { ...process.env, PORT: port, ...extraEnv },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    const child: SpawnedChild = {
        proc: proc as Bun.Subprocess<"ignore", "pipe", "pipe">,
        out: captureStream(proc.stdout as ReadableStream<Uint8Array>),
        err: captureStream(proc.stderr as ReadableStream<Uint8Array>),
        port,
    };
    children.push(child);
    return child;
}

function killChild(child: SpawnedChild): void {
    try {
        child.proc.kill();
    } catch {
        // Already exited.
    }
}

function killAllChildren(): void {
    for (const child of children) killChild(child);
}

function childOutput(child: SpawnedChild): string {
    return child.out.text() + child.err.text();
}

async function waitUntilHealthy(child: SpawnedChild, label: string): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const exited = await Promise.race([
            child.proc.exited.then(() => true),
            sleep(100).then(() => false),
        ]);
        if (exited) {
            throw new Error(
                `${label} exited during startup:\n${childOutput(child)}`,
            );
        }
        try {
            const response = await fetch(`http://127.0.0.1:${child.port}/api/v1/system/health`);
            if (response.ok) return;
        } catch {
            // Not accepting connections yet.
        }
    }
    throw new Error(`${label} never became ready`);
}

function sleep(ms: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
}

async function callApi(
    port: string,
    method: string,
    path: string,
    body?: unknown,
): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": JSON_MEDIA_TYPE },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

async function pollUntilStatus(
    port: string,
    runId: string,
    target: string,
): Promise<RunRepresentation> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const response = await callApi(port, "GET", `/api/v1/runs/${runId}`);
        if (response.ok) {
            const run = (await response.json()) as RunRepresentation;
            if (run.status === target) return run;
        }
        await sleep(60);
    }
    throw new Error(`run ${runId} never reached status ${target}`);
}

async function proveHealthAndVersion(daemonPort: string): Promise<void> {
    const healthResponse = await fetch(`http://127.0.0.1:${daemonPort}/api/v1/system/health`);
    const healthBody = (await healthResponse.json()) as Record<string, unknown>;
    check(
        "daemon health answers independently",
        healthResponse.status === 200 && healthBody.status === "ok",
        { status: healthResponse.status, body: healthBody },
    );

    const versionResponse = await fetch(`http://127.0.0.1:${daemonPort}/api/v1/system/version`);
    const versionBody: unknown = await versionResponse.json();
    check(
        "daemon reports service and interface version",
        versionResponse.status === 200 &&
            isVersionInfo(versionBody) &&
            versionBody.service === "rostrum-daemon" &&
            versionBody.interfaceVersion === "v1",
        { status: versionResponse.status, body: versionBody },
    );
}

async function proveSubmission(apiPort: string): Promise<string> {
    const response = await callApi(apiPort, "POST", "/api/v1/runs", submission());
    const body: unknown = await response.json();
    const accepted =
        response.status === 201 &&
        isRunRepresentation(body) &&
        body.status === "queued" &&
        body.currentSteps.length === 0 &&
        body.failures.length === 0;
    check("submission returns 201 with the queued representation", accepted, {
        status: response.status,
        body,
    });
    if (!isRunRepresentation(body)) throw new Error("submission scenario failed; cannot continue");
    return body.runId;
}

async function proveRequestIdEnvelope(daemonPort: string, daemon: SpawnedChild): Promise<void> {
    const response = await fetch(`http://127.0.0.1:${daemonPort}/api/v1/runs`, {
        method: "POST",
        headers: { "content-type": JSON_MEDIA_TYPE, [REQUEST_ID_HEADER]: ECHO_REQUEST_ID },
        body: JSON.stringify(submission()),
    });
    check(
        "daemon echoes the caller-supplied x-request-id",
        response.status === 201 && response.headers.get(REQUEST_ID_HEADER) === ECHO_REQUEST_ID,
        { status: response.status, echoed: response.headers.get(REQUEST_ID_HEADER) },
    );
    await response.text();
    // The echo rule also requires logging; the log line is written before the
    // response returns, so the live capture already holds it.
    check(
        "daemon logs the request id",
        daemon.out.text().includes(`"requestId":"${ECHO_REQUEST_ID}"`),
        daemon.out.text().slice(-2000),
    );
}

async function proveProxiedRequestId(daemon: SpawnedChild): Promise<void> {
    // The Control API wrapper generates a UUID per daemon call; the daemon
    // logs every request's id, so proxied submissions must appear there.
    const uuidLogged =
        /"requestId":"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/.test(
            daemon.out.text(),
        );
    check("control api sends x-request-id on daemon calls", uuidLogged, daemon.out.text().slice(-2000));
}

async function proveRetrieval(apiPort: string, runId: string): Promise<void> {
    const running = await pollUntilStatus(apiPort, runId, "running");
    const step = running.currentSteps[0];
    check(
        "running projection lists the active step",
        step !== undefined &&
            step.stepId === "greet" &&
            step.state === "running" &&
            running.workflowVersion === WORKFLOW_VERSION,
        running,
    );
    const succeeded = await pollUntilStatus(apiPort, runId, "succeeded");
    check(
        "succeeded run returns output with empty projections",
        succeeded.output !== null &&
            (succeeded.output as Record<string, unknown>).message === EXPECTED_OUTPUT_MESSAGE &&
            succeeded.currentSteps.length === 0 &&
            succeeded.failures.length === 0,
        succeeded,
    );
}

async function proveRejectionPassThrough(apiPort: string, daemonPort: string): Promise<void> {
    // The daemon rejects before creating a run; the Control API passes the
    // status and body through verbatim.
    const missingInput = {
        workflowId: WORKFLOW_ID,
        workflowVersion: WORKFLOW_VERSION,
        inputs: {},
    };
    const direct = await callApi(daemonPort, "POST", "/api/v1/runs", missingInput);
    const directText = await direct.text();
    const proxied = await callApi(apiPort, "POST", "/api/v1/runs", missingInput);
    const proxiedText = await proxied.text();
    const proxiedBody = JSON.parse(proxiedText) as Record<string, unknown>;
    check(
        "missing-input rejection passes through verbatim with no run ID",
        proxied.status === direct.status &&
            proxied.status === 400 &&
            proxiedText === directText &&
            proxiedBody.code === RUN_INPUT_MISSING &&
            !("runId" in proxiedBody),
        { directStatus: direct.status, proxiedStatus: proxied.status, proxiedText },
    );

    const unknownWorkflow = {
        workflowId: "0198ffff-ffff-7fff-8fff-ffffffffffff",
        workflowVersion: WORKFLOW_VERSION,
        inputs: { name: "Ada" },
    };
    const directUnknown = await callApi(daemonPort, "POST", "/api/v1/runs", unknownWorkflow);
    const directUnknownText = await directUnknown.text();
    const proxiedUnknown = await callApi(apiPort, "POST", "/api/v1/runs", unknownWorkflow);
    const proxiedUnknownText = await proxiedUnknown.text();
    const unknownBody = JSON.parse(proxiedUnknownText) as Record<string, unknown>;
    check(
        "unknown-workflow rejection passes through verbatim",
        proxiedUnknown.status === 404 &&
            proxiedUnknownText === directUnknownText &&
            unknownBody.code === RUN_WORKFLOW_NOT_FOUND,
        { status: proxiedUnknown.status, body: proxiedUnknownText },
    );
}

async function proveUnknownRunPassThrough(apiPort: string, daemonPort: string): Promise<void> {
    const direct = await callApi(daemonPort, "GET", `/api/v1/runs/${UNKNOWN_RUN_ID}`);
    const directText = await direct.text();
    const proxied = await callApi(apiPort, "GET", `/api/v1/runs/${UNKNOWN_RUN_ID}`);
    const proxiedText = await proxied.text();
    check(
        "unknown-run 404 passes through verbatim",
        proxied.status === direct.status && proxied.status === 404 && proxiedText === directText,
        { directStatus: direct.status, proxiedStatus: proxied.status, proxiedText },
    );
}

async function proveInProcess(): Promise<void> {
    const app = createDaemonApp();
    const api = ControlApiApp.withInProcessDaemon(app.fetch);
    const response = await api.fetch(
        new Request("http://control-api.internal/api/v1/runs", {
            method: "POST",
            headers: { "content-type": JSON_MEDIA_TYPE },
            body: JSON.stringify(submission()),
        }),
    );
    const body: unknown = await response.json();
    check(
        "in-process submission returns the queued representation",
        response.status === 201 && isRunRepresentation(body) && body.status === "queued",
        { status: response.status, body },
    );
    if (!isRunRepresentation(body)) {
        app.close();
        return;
    }

    // Drive the daemon application directly, without a socket.
    const daemonRequest = new Request("http://daemon.internal/api/v1/runs", {
        method: "POST",
        headers: { "content-type": JSON_MEDIA_TYPE },
        body: JSON.stringify(submission()),
    });
    const daemonResponse = await app.fetch(daemonRequest);
    const daemonBody: unknown = await daemonResponse.json();
    check(
        "daemon application serves its surface without a socket",
        daemonResponse.status === 201 && isRunRepresentation(daemonBody),
        { status: daemonResponse.status, body: daemonBody },
    );
    if (!isRunRepresentation(daemonBody)) {
        app.close();
        return;
    }

    const deadline = Date.now() + 5000;
    let terminal: RunRepresentation | undefined;
    while (Date.now() < deadline && terminal === undefined) {
        const lookup = await app.fetch(
            new Request(`http://daemon.internal/api/v1/runs/${daemonBody.runId}`),
        );
        const run: unknown = await lookup.json();
        if (isRunRepresentation(run) && run.status === "succeeded") terminal = run;
        else await sleep(60);
    }
    check(
        "in-process run reaches succeeded through the daemon surface",
        terminal !== undefined &&
            terminal.output !== null &&
            (terminal.output as Record<string, unknown>).message === EXPECTED_OUTPUT_MESSAGE,
        terminal,
    );
    app.close();
}

async function proveTimeout(): Promise<void> {
    const daemon = spawnChild("daemon.ts", HUNG_DAEMON_PORT, { DAEMON_FAULT: "hang-submission" });
    const api = spawnChild("control-api.ts", HUNG_API_PORT, {
        DAEMON_URL: `http://127.0.0.1:${HUNG_DAEMON_PORT}`,
        DAEMON_TIMEOUT_MS: "400",
    });
    try {
        await waitUntilHealthy(daemon, "hung daemon");
        await waitUntilHealthy(api, "timeout control api");
        const response = await callApi(HUNG_API_PORT, "POST", "/api/v1/runs", submission());
        const body = (await response.json()) as PublicError;
        check(
            "deadline expiry maps to 504 run.daemon.timeout",
            response.status === 504 &&
                body.code === DAEMON_TIMEOUT &&
                Array.isArray(body.findings),
            { status: response.status, body },
        );

        // The submission may still have been accepted; no run ID reached the
        // caller, so the accepted ID exists only in the daemon log.
        const accepted = /"msg":"run accepted","runId":"([0-9a-f-]{36})"/.exec(daemon.out.text());
        check("timed-out submission was accepted by the daemon", accepted !== null, {
            daemonLog: daemon.out.text().slice(-2000),
        });
        if (accepted) {
            const lookup = await fetch(
                `http://127.0.0.1:${HUNG_DAEMON_PORT}/api/v1/runs/${accepted[1] as string}`,
            );
            check(
                "the accepted run is retrievable only through the daemon log",
                lookup.status === 200,
                { status: lookup.status },
            );
            await lookup.text();
        }
    } finally {
        killChild(daemon);
        killChild(api);
    }
}

async function proveUnavailability(): Promise<void> {
    const api = spawnChild("control-api.ts", UNAVAILABLE_API_PORT, {
        DAEMON_URL: UNAVAILABLE_DAEMON_URL,
        DAEMON_TIMEOUT_MS: "2000",
    });
    try {
        await waitUntilHealthy(api, "unavailable-daemon control api");
        const submitResponse = await callApi(UNAVAILABLE_API_PORT, "POST", "/api/v1/runs", submission());
        const submitBody = (await submitResponse.json()) as PublicError;
        check(
            "unavailable daemon maps to 503 run.daemon.unavailable",
            submitResponse.status === 503 && submitBody.code === DAEMON_UNAVAILABLE,
            { status: submitResponse.status, body: submitBody },
        );

        const getResponse = await callApi(
            UNAVAILABLE_API_PORT,
            "GET",
            `/api/v1/runs/${UNKNOWN_RUN_ID}`,
        );
        const getBody = (await getResponse.json()) as PublicError;
        check(
            "retrieval against an unavailable daemon maps to 503",
            getResponse.status === 503 && getBody.code === DAEMON_UNAVAILABLE,
            { status: getResponse.status, body: getBody },
        );
    } finally {
        killChild(api);
    }
}

async function proveProtocolError(): Promise<void> {
    const daemon = spawnChild("daemon.ts", MALFORMED_DAEMON_PORT, {
        DAEMON_FAULT: "malformed-submission",
    });
    const api = spawnChild("control-api.ts", MALFORMED_API_PORT, {
        DAEMON_URL: `http://127.0.0.1:${MALFORMED_DAEMON_PORT}`,
        DAEMON_TIMEOUT_MS: "2000",
    });
    try {
        await waitUntilHealthy(daemon, "malformed daemon");
        await waitUntilHealthy(api, "protocol control api");
        const response = await callApi(MALFORMED_API_PORT, "POST", "/api/v1/runs", submission());
        const body = (await response.json()) as PublicError;
        check(
            "malformed daemon response maps to 500 run.daemon.protocol",
            response.status === 500 && body.code === DAEMON_PROTOCOL,
            { status: response.status, body },
        );
    } finally {
        killChild(daemon);
        killChild(api);
    }
}

async function proveGracefulShutdown(): Promise<void> {
    // Signals are hard terminations on Windows, so the harness drives the
    // real shutdown path through the same routine the SIGTERM handler calls.
    const daemon = spawnChild("daemon.ts", SHUTDOWN_DAEMON_PORT, {
        DAEMON_TEST_SHUTDOWN_AFTER_MS: "600",
    });
    await waitUntilHealthy(daemon, "shutdown-test daemon");
    const exitCode = await Promise.race([
        daemon.proc.exited,
        sleep(15000).then(() => "timeout" as const),
    ]);
    const text = childOutput(daemon);
    check("daemon exits cleanly on shutdown", exitCode === 0, { exitCode, output: text.slice(-2000) });

    const listened = text.indexOf('"msg":"listening"');
    const started = text.indexOf('"msg":"shutdown started"');
    const complete = text.indexOf('"msg":"shutdown complete"');
    check(
        "shutdown logs listening, shutdown started, and shutdown complete in order",
        listened !== -1 && started > listened && complete > started,
        { listened, started, complete },
    );

    let socketClosed = false;
    try {
        await fetch(`http://127.0.0.1:${SHUTDOWN_DAEMON_PORT}/api/v1/system/health`);
    } catch {
        socketClosed = true;
    }
    check("the socket is closed after shutdown", socketClosed, {});
}

async function proveInvalidConfig(): Promise<void> {
    const proc = Bun.spawn(["bun", "run", "daemon.ts"], {
        cwd: import.meta.dir,
        env: { ...process.env, PORT: "abc" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
    const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
    const text = stdout + stderr;
    check(
        "invalid port fails startup before the socket opens",
        exitCode !== 0 &&
            text.includes("invalid configuration") &&
            text.includes("/port") &&
            !text.includes('"msg":"listening"'),
        { exitCode, output: text.slice(0, 2000) },
    );
}

async function main(): Promise<void> {
    const daemon = spawnChild("daemon.ts", DAEMON_PORT, {});
    const api = spawnChild("control-api.ts", API_PORT, {
        DAEMON_URL: `http://127.0.0.1:${DAEMON_PORT}`,
        DAEMON_TIMEOUT_MS: "5000",
    });
    try {
        await waitUntilHealthy(daemon, "daemon");
        await waitUntilHealthy(api, "control api");
        await proveHealthAndVersion(DAEMON_PORT);
        const runId = await proveSubmission(API_PORT);
        await proveRequestIdEnvelope(DAEMON_PORT, daemon);
        await proveRetrieval(API_PORT, runId);
        await proveRejectionPassThrough(API_PORT, DAEMON_PORT);
        await proveUnknownRunPassThrough(API_PORT, DAEMON_PORT);
        await proveProxiedRequestId(daemon);
    } finally {
        killChild(daemon);
        killChild(api);
    }
    await proveInProcess();
    await proveTimeout();
    await proveUnavailability();
    await proveProtocolError();
    await proveGracefulShutdown();
    await proveInvalidConfig();
}

try {
    await main();
} catch (error) {
    check("harness completed", false, String(error));
} finally {
    killAllChildren();
}

const failed = results.filter((result) => !result.ok);
console.log(
    JSON.stringify({
        proof: "e2-s2",
        passed: results.length - failed.length,
        failed: failed.length,
        failures: failed.map((result) => result.scenario),
    }),
);
if (failed.length > 0) process.exit(1);