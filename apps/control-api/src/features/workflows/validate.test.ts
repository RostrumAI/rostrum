import { describe, expect, mock, test } from "bun:test";
import type { Finding } from "@rostrum/workflow";
import { bindRoute, fetchJson, jsonRequest, servicesWith } from "../../testing/handlers";
import { createHandler, route } from "./validate";

const FINDINGS: Finding[] = [
    {
        code: "workflow.shape.required-field",
        message: "steps is required",
        blocking: true,
        path: "",
    },
];

function appFor(validate: object) {
    return bindRoute(
        route.method,
        "workflows",
        route.path,
        createHandler(servicesWith({ validate })),
        route.parameters,
    );
}

describe("POST /workflows/validate", () => {
    test("answers 200 with the validation outcome without saving", async () => {
        const validate = mock(async () => ({
            findings: FINDINGS,
            validForPublication: false,
        }));
        const app = appFor(validate);
        const { res, body } = await fetchJson(
            app,
            "/api/v1/workflows/validate",
            jsonRequest("POST", { name: "x" }),
        );
        expect(res.status).toBe(200);
        expect(body).toEqual({ findings: FINDINGS, validForPublication: false });
        expect(validate).toHaveBeenCalledTimes(1);
        expect(validate).toHaveBeenCalledWith(`{"name":"x"}`);
    });

    test("answers 200 with empty findings for a valid document", async () => {
        const validate = mock(async () => ({ findings: [], validForPublication: true }));
        const app = appFor(validate);
        const { res, body } = await fetchJson(
            app,
            "/api/v1/workflows/validate",
            jsonRequest("POST", { interfaceVersion: "v1", steps: [] }),
        );
        expect(res.status).toBe(200);
        expect(body).toEqual({ findings: [], validForPublication: true });
        expect(validate).toHaveBeenCalledWith(`{"interfaceVersion":"v1","steps":[]}`);
    });

    test("answers 400 with parse findings for invalid JSON", async () => {
        const validate = mock(async () => ({ findings: [], validForPublication: true }));
        const app = appFor(validate);
        const res = await app.fetch(
            new Request("http://localhost/api/v1/workflows/validate", {
                method: "POST",
                body: `{"name":"a","name":"b"}`,
            }),
        );
        expect(res.status).toBe(400);
        const payload = await res.json();
        expect(payload).toMatchObject({
            code: "invalid_workflow_input",
            findings: [{ code: "workflow.parse.duplicate-key", blocking: true }],
        });
        expect(validate).not.toHaveBeenCalled();
    });
});
