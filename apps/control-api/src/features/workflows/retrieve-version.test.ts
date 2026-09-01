import { describe, expect, mock, test } from "bun:test";
import { bindRoute, fetchJson, servicesWith } from "../../testing/handlers";
import { createHandler, route } from "./retrieve-version";

const WORKFLOW_ID = "0192b0a0-7e1d-7000-8000-0000000000cd";
const REVISION_ID = "0192b0a0-7e1d-7000-8000-0000000000cc";
const PATH = `/api/v1/workflows/${WORKFLOW_ID}/versions/1`;
const DIGEST = "a".repeat(64);

const version = {
    versionNumber: 1,
    revisionId: REVISION_ID,
    interfaceVersion: "v1",
    canonicalText: `{"id":"${WORKFLOW_ID}"}`,
    digest: DIGEST,
    createdAt: new Date(0),
};

function appFor(getPublishedVersion: object) {
    return bindRoute(
        route.method,
        "workflows",
        route.path,
        createHandler(servicesWith({ getPublishedVersion })),
        route.parameters,
    );
}

describe("GET /workflows/:workflowId/versions/:versionNumber", () => {
    test("answers 200 with the stored canonical text", async () => {
        const getPublishedVersion = mock(async () => version);
        const app = appFor(getPublishedVersion);
        const { res, body } = await fetchJson(app, PATH);
        expect(res.status).toBe(200);
        expect(body).toEqual({
            versionNumber: 1,
            revisionId: REVISION_ID,
            interfaceVersion: "v1",
            digest: DIGEST,
            content: version.canonicalText,
        });
        expect(getPublishedVersion).toHaveBeenCalledTimes(1);
        expect(getPublishedVersion).toHaveBeenCalledWith(WORKFLOW_ID, 1);
    });

    test("answers 404 when the version does not exist", async () => {
        const getPublishedVersion = mock(async () => null);
        const app = appFor(getPublishedVersion);
        const { res, body } = await fetchJson(app, PATH);
        expect(res.status).toBe(404);
        expect(body).toMatchObject({ code: "not_found" });
        expect(getPublishedVersion).toHaveBeenCalledWith(WORKFLOW_ID, 1);
    });

    test("answers 400 for a non-numeric version number before the handler runs", async () => {
        const getPublishedVersion = mock(async () => version);
        const app = appFor(getPublishedVersion);
        const { res, body } = await fetchJson(app, `/api/v1/workflows/${WORKFLOW_ID}/versions/abc`);
        expect(res.status).toBe(400);
        expect(body).toMatchObject({ code: "invalid_workflow_input" });
        expect(getPublishedVersion).not.toHaveBeenCalled();
    });

    test("answers 400 for a zero version number", async () => {
        const getPublishedVersion = mock(async () => version);
        const app = appFor(getPublishedVersion);
        const { res } = await fetchJson(app, `/api/v1/workflows/${WORKFLOW_ID}/versions/0`);
        expect(res.status).toBe(400);
        expect(getPublishedVersion).not.toHaveBeenCalled();
    });
});
