import { describe, expect, test } from "bun:test";
import type { Finding } from "@rostrum/workflow";
import { bindRoute, fetchJson, jsonRequest, servicesWith } from "../../testing/handlers";
import { createHandler, route } from "./publish";

const WORKFLOW_ID = "0192b0a0-7e1d-7000-8000-0000000000cd";
const PATH = `/api/v1/workflows/${WORKFLOW_ID}/publish`;
const DIGEST = "a".repeat(64);

const FINDINGS: Finding[] = [
    {
        code: "workflow.shape.required-field",
        message: "steps is required",
        blocking: true,
        path: "",
    },
];

function appFor(publish: object) {
    return bindRoute(
        route.method,
        "workflows",
        route.path,
        createHandler(servicesWith({ publish })),
        route.parameters,
    );
}

describe("POST /workflows/:workflowId/publish", () => {
    test("publishes and answers 200 with the version identity", async () => {
        const app = appFor(async () => ({
            outcome: "published",
            versionNumber: 3,
            interfaceVersion: "v1",
            digest: DIGEST,
        }));
        const { res, body } = await fetchJson(app, PATH, jsonRequest("POST", undefined));
        expect(res.status).toBe(200);
        expect(body).toEqual({
            workflowId: WORKFLOW_ID,
            versionNumber: 3,
            interfaceVersion: "v1",
            digest: DIGEST,
        });
    });

    test("answers the identical body for an idempotent re-publish", async () => {
        const app = appFor(async () => ({
            outcome: "already-published",
            versionNumber: 3,
            interfaceVersion: "v1",
            digest: DIGEST,
        }));
        const { res, body } = await fetchJson(app, PATH, jsonRequest("POST", undefined));
        expect(res.status).toBe(200);
        expect(body).toEqual({
            workflowId: WORKFLOW_ID,
            versionNumber: 3,
            interfaceVersion: "v1",
            digest: DIGEST,
        });
    });

    test("answers 422 with the findings when the current revision blocks publication", async () => {
        const app = appFor(async () => ({ outcome: "blocking-findings", findings: FINDINGS }));
        const { res, body } = await fetchJson(app, PATH, jsonRequest("POST", undefined));
        expect(res.status).toBe(422);
        expect(body).toMatchObject({ code: "workflow_not_valid", findings: FINDINGS });
    });

    test("answers 404 when the workflow does not exist", async () => {
        const app = appFor(async () => ({ outcome: "not-found" }));
        const { res, body } = await fetchJson(app, PATH, jsonRequest("POST", undefined));
        expect(res.status).toBe(404);
        expect(body).toMatchObject({ code: "not_found" });
    });

    test("answers 404 revision_not_found when the current revision vanished", async () => {
        const app = appFor(async () => ({ outcome: "revision-not-found" }));
        const { res, body } = await fetchJson(app, PATH, jsonRequest("POST", undefined));
        expect(res.status).toBe(404);
        expect(body).toMatchObject({ code: "revision_not_found" });
    });

    test("answers 400 for a malformed workflow id before the handler runs", async () => {
        const app = appFor(async () => ({
            outcome: "published",
            versionNumber: 1,
            interfaceVersion: "v1",
            digest: DIGEST,
        }));
        const { res, body } = await fetchJson(
            app,
            "/api/v1/workflows/not-a-uuid/publish",
            jsonRequest("POST", undefined),
        );
        expect(res.status).toBe(400);
        expect(body).toMatchObject({ code: "invalid_workflow_input" });
    });
});
