import { describe, expect, test } from "bun:test";
import type { Finding } from "@rostrum/workflow";
import {
    bindRoute,
    fetchJson,
    jsonRequest,
    revisionFixture,
    servicesWith,
} from "../../testing/handlers";
import { createHandler, route } from "./save";

const WORKFLOW_ID = "0192b0a0-7e1d-7000-8000-0000000000cd";
const PATH = `/api/v1/workflows/${WORKFLOW_ID}/revisions`;
const BASE = "0192b0a0-7e1d-7000-8000-0000000000aa";

const FINDINGS: Finding[] = [
    {
        code: "workflow.shape.required-field",
        message: "steps is required",
        blocking: true,
        path: "",
    },
];

function appFor(saveRevision: object) {
    return bindRoute(
        route.method,
        "workflows",
        route.path,
        createHandler(servicesWith({ saveRevision })),
        route.parameters,
    );
}

describe("PUT /workflows/:workflowId/revisions", () => {
    test("stores a revision and answers 200 with it", async () => {
        const app = appFor(async () => ({ outcome: "saved", revision: revisionFixture() }));
        const { res, body } = await fetchJson(
            app,
            PATH,
            jsonRequest("PUT", { baseRevision: BASE, document: { name: "x" } }),
        );
        expect(res.status).toBe(200);
        expect(body).toMatchObject({ revisionId: revisionFixture().revisionId, type: "save" });
    });

    test("answers 409 with the current revision on a stale base revision", async () => {
        const current = revisionFixture({ findings: FINDINGS });
        const app = appFor(async () => ({ outcome: "conflict", currentRevision: current }));
        const { res, body } = await fetchJson(
            app,
            PATH,
            jsonRequest("PUT", { baseRevision: BASE, document: {} }),
        );
        expect(res.status).toBe(409);
        expect(body).toMatchObject({
            code: "revision_conflict",
            currentRevision: current.revisionId,
            findings: FINDINGS,
        });
    });

    test("answers 404 when the workflow does not exist", async () => {
        const app = appFor(async () => ({ outcome: "not-found" }));
        const { res, body } = await fetchJson(
            app,
            PATH,
            jsonRequest("PUT", { baseRevision: BASE, document: {} }),
        );
        expect(res.status).toBe(404);
        expect(body).toMatchObject({ code: "not_found" });
    });

    test("answers 400 when the envelope omits the base revision", async () => {
        const app = appFor(async () => ({ outcome: "saved", revision: revisionFixture() }));
        const { res, body } = await fetchJson(app, PATH, jsonRequest("PUT", { document: {} }));
        expect(res.status).toBe(400);
        expect(body).toMatchObject({ code: "invalid_workflow_input" });
    });

    test("answers 400 when the base revision is not an id", async () => {
        const app = appFor(async () => ({ outcome: "saved", revision: revisionFixture() }));
        const { res } = await fetchJson(
            app,
            PATH,
            jsonRequest("PUT", { baseRevision: "nope", document: {} }),
        );
        expect(res.status).toBe(400);
    });
});
