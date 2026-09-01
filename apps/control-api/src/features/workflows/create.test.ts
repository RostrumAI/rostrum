import { describe, expect, test } from "bun:test";
import {
    bindRoute,
    fetchJson,
    jsonRequest,
    revisionFixture,
    servicesWith,
} from "../../testing/handlers";
import { createHandler, route } from "./create";

const WORKFLOW_ID = "0192b0a0-7e1d-7000-8000-0000000000cd";

const app = bindRoute(
    route.method,
    "workflows",
    route.path,
    createHandler(
        servicesWith({
            createDraft: async () => ({ workflowId: WORKFLOW_ID, revision: revisionFixture() }),
        }),
    ),
    route.parameters,
);

describe("POST /workflows", () => {
    test("creates a draft and answers 201 with the first revision", async () => {
        const { res, body } = await fetchJson(
            app,
            "/api/v1/workflows",
            jsonRequest("POST", { document: { name: "x" }, name: "first" }),
        );
        expect(res.status).toBe(201);
        expect(body).toEqual(revisionResponseShape());
    });

    test("answers 400 when the request body omits the document", async () => {
        const { res, body } = await fetchJson(
            app,
            "/api/v1/workflows",
            jsonRequest("POST", { name: "x" }),
        );
        expect(res.status).toBe(400);
        expect(body).toMatchObject({ code: "invalid_workflow_input" });
    });

    test("answers 400 when the body is not valid JSON", async () => {
        const res = await app.fetch(
            new Request("http://localhost/api/v1/workflows", { method: "POST", body: "not json" }),
        );
        expect(res.status).toBe(400);
        const payload = await res.json();
        expect(payload).toMatchObject({
            code: "invalid_workflow_input",
            findings: [{ blocking: true }],
        });
    });

    test("answers 400 when the request body carries an unknown member", async () => {
        const { res, body } = await fetchJson(
            app,
            "/api/v1/workflows",
            jsonRequest("POST", { document: {}, extra: 1 }),
        );
        expect(res.status).toBe(400);
        expect(body).toMatchObject({ code: "invalid_workflow_input" });
    });
});

/** The exact WorkflowRevision body the revision fixture maps to. */
function revisionResponseShape() {
    const revision = revisionFixture();
    return {
        workflowId: revision.workflowId,
        revisionId: revision.revisionId,
        name: revision.name,
        type: revision.type,
        content: revision.content,
        findings: revision.findings,
    };
}
