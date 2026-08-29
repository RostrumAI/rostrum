import type { StoredRevision } from "@rostrum/database";
import { Hono } from "hono";
import {
    type FeatureHandler,
    type HttpMethod,
    type ParameterDefinition,
    parameterGuard,
} from "../loader";
import type { Services } from "../services";
import type { WorkflowService } from "../workflows/service";

/** The path prefix every feature route binds under. */
export const API_PREFIX = "/api/v1";

/** A complete stored revision fixture tests can override field by field. */
export function revisionFixture(overrides: Partial<StoredRevision> = {}): StoredRevision {
    return {
        revisionId: "0192b0a0-7e1d-7000-8000-0000000000cc",
        workflowId: "0192b0a0-7e1d-7000-8000-0000000000cd",
        name: null,
        content: `{"id":"0192b0a0-7e1d-7000-8000-0000000000cd","name":"x"}`,
        type: "save",
        findings: [],
        createdAt: new Date(0),
        ...overrides,
    };
}

/** Wraps a partial workflow-service stub behind the Services contract. */
export function servicesWith(workflows: object): Services {
    return { workflows: workflows as WorkflowService };
}

/**
 * Binds one handler the way the app does: the feature area joins the
 * versioned prefix, then the documented parameter guard runs in front of
 * the handler, so malformed path parameters answer 400.
 */
export function bindRoute(
    method: HttpMethod,
    area: string,
    path: string,
    handler: FeatureHandler,
    parameters: ParameterDefinition[] = [],
): Hono {
    const bound = path === "/" ? `/${area}` : `/${area}${path}`;
    const app = new Hono();
    app.on(method, `${API_PREFIX}${bound}`, parameterGuard(parameters), handler);
    return app;
}

/** Fetches one route as JSON and parses the body, tolerating empty bodies. */
export async function fetchJson(
    app: Hono,
    path: string,
    init?: RequestInit,
): Promise<{ res: Response; body: unknown }> {
    const res = await app.fetch(new Request(`http://localhost${path}`, init));
    const body = await res.json().catch(() => null);
    return { res, body };
}

/** Builds a JSON request init with the given method and body. */
export function jsonRequest(method: HttpMethod, body: unknown): RequestInit {
    return {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    };
}
