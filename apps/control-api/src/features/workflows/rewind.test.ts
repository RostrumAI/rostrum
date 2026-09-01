import { describe, expect, mock, test } from "bun:test";
import {
    bindRoute,
    fetchJson,
    jsonRequest,
    revisionFixture,
    servicesWith,
} from "../../testing/handlers";
import { createHandler, route } from "./rewind";

const WORKFLOW_ID = "0192b0a0-7e1d-7000-8000-0000000000cd";
const PATH = `/api/v1/workflows/${WORKFLOW_ID}/rewind`;
const TARGET = "0192b0a0-7e1d-7000-8000-0000000000aa";

function appFor(rewind: object) {
    return bindRoute(
        route.method,
        "workflows",
        route.path,
        createHandler(servicesWith({ rewind })),
        route.parameters,
    );
}

describe("POST /workflows/:workflowId/rewind", () => {
    test("rewinds and answers 200 with the appended copy", async () => {
        const copy = revisionFixture({ type: "rewind", name: null });
        const rewind = mock(async () => ({ outcome: "rewound", revision: copy }));
        const app = appFor(rewind);
        const { res, body } = await fetchJson(
            app,
            PATH,
            jsonRequest("POST", { targetRevisionId: TARGET }),
        );
        expect(res.status).toBe(200);
        expect(body).toMatchObject({ revisionId: copy.revisionId, type: "rewind" });
        expect(rewind).toHaveBeenCalledTimes(1);
        expect(rewind).toHaveBeenCalledWith(WORKFLOW_ID, TARGET);
    });

    test("answers 200 with the unchanged revision when the rewind is a no-op", async () => {
        const current = revisionFixture();
        const rewind = mock(async () => ({ outcome: "no-op", revision: current }));
        const app = appFor(rewind);
        const { res, body } = await fetchJson(
            app,
            PATH,
            jsonRequest("POST", { targetRevisionId: current.revisionId }),
        );
        expect(res.status).toBe(200);
        expect(body).toMatchObject({ revisionId: current.revisionId, type: "save" });
        expect(rewind).toHaveBeenCalledWith(WORKFLOW_ID, current.revisionId);
    });

    test("answers 404 revision_not_found when the target does not exist", async () => {
        const rewind = mock(async () => ({ outcome: "target-not-found" }));
        const app = appFor(rewind);
        const { res, body } = await fetchJson(
            app,
            PATH,
            jsonRequest("POST", { targetRevisionId: TARGET }),
        );
        expect(res.status).toBe(404);
        expect(body).toMatchObject({ code: "revision_not_found" });
        expect(rewind).toHaveBeenCalledWith(WORKFLOW_ID, TARGET);
    });

    test("answers 404 when the workflow does not exist", async () => {
        const rewind = mock(async () => ({ outcome: "not-found" }));
        const app = appFor(rewind);
        const { res, body } = await fetchJson(
            app,
            PATH,
            jsonRequest("POST", { targetRevisionId: TARGET }),
        );
        expect(res.status).toBe(404);
        expect(body).toMatchObject({ code: "not_found" });
        expect(rewind).toHaveBeenCalledWith(WORKFLOW_ID, TARGET);
    });

    test("answers 400 when the request body omits the target revision", async () => {
        const rewind = mock(async () => ({ outcome: "rewound", revision: revisionFixture() }));
        const app = appFor(rewind);
        const { res, body } = await fetchJson(app, PATH, jsonRequest("POST", {}));
        expect(res.status).toBe(400);
        expect(body).toMatchObject({ code: "invalid_workflow_input" });
        expect(rewind).not.toHaveBeenCalled();
    });

    test("answers 400 when the body is not valid JSON", async () => {
        const rewind = mock(async () => ({ outcome: "rewound", revision: revisionFixture() }));
        const app = appFor(rewind);
        const res = await app.fetch(
            new Request(`http://localhost${PATH}`, { method: "POST", body: "{oops" }),
        );
        expect(res.status).toBe(400);
        const payload = await res.json();
        expect(payload).toMatchObject({
            code: "invalid_workflow_input",
            findings: [{ blocking: true }],
        });
        expect(rewind).not.toHaveBeenCalled();
    });
});
