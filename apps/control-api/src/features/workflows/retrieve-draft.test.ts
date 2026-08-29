import { describe, expect, test } from "bun:test";
import { bindRoute, fetchJson, revisionFixture, servicesWith } from "../../testing/handlers";
import { createHandler, route } from "./retrieve-draft";

const WORKFLOW_ID = "0192b0a0-7e1d-7000-8000-0000000000cd";
const PATH = `/api/v1/workflows/${WORKFLOW_ID}`;

function appFor(getCurrentRevision: object) {
    return bindRoute(
        route.method,
        "workflows",
        route.path,
        createHandler(servicesWith({ getCurrentRevision })),
        route.parameters,
    );
}

describe("GET /workflows/:workflowId", () => {
    test("answers 200 with the current revision", async () => {
        const app = appFor(async () => revisionFixture());
        const { res, body } = await fetchJson(app, PATH);
        expect(res.status).toBe(200);
        expect(body).toMatchObject({
            workflowId: WORKFLOW_ID,
            revisionId: revisionFixture().revisionId,
            type: "save",
        });
    });

    test("answers 404 when the workflow does not exist", async () => {
        const app = appFor(async () => null);
        const { res, body } = await fetchJson(app, PATH);
        expect(res.status).toBe(404);
        expect(body).toMatchObject({ code: "not_found" });
    });

    test("answers 400 for a malformed workflow id before the handler runs", async () => {
        const app = appFor(async () => revisionFixture());
        const { res, body } = await fetchJson(app, "/api/v1/workflows/not-a-uuid");
        expect(res.status).toBe(400);
        expect(body).toMatchObject({ code: "invalid_workflow_input" });
    });
});
