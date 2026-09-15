/** @fileoverview Declared-input contract tests for the service builder. */

import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { createServerApp, createServiceRegistrar } from "./app";
import { defineSchema } from "./schema";
import { createServiceBuilder } from "./service";

/** The application context these services receive. */
interface TestContext {
    /** A handler-facing value, so application fields are observable. */
    readonly greeting: string;
}

const bodySchema = Type.Object({ value: Type.String() });
const paramsSchema = Type.Object({ itemId: Type.String({ minLength: 3 }) });
const item = defineSchema("Item", bodySchema);

const defineService = createServiceBuilder<TestContext, "system">();

/** Records what one handler received, so the service contract is observable. */
interface Observed {
    runs: number;
    request?: Record<string, unknown>;
}

/** Builds an application whose single service records its own request. */
function buildApp(observed: Observed) {
    const app = createServerApp<TestContext>({
        serviceName: "test-service",
        tags: ["system"],
        title: "Test API",
        description: "Test document.",
        version: "1.2.3",
    });
    const service = defineService({
        method: "POST",
        path: "/api/items/:itemId",
        request: { body: item, params: paramsSchema },
        openapi: { operationId: "createItem", summary: "Create an item", tags: ["system"] },
        responses: { 200: { description: "The created item", body: item } },
        handler: (request, response, context) => {
            observed.runs += 1;
            observed.request = {
                body: request.body,
                bodyText: request.bodyText,
                params: request.params,
                contentType: request.headers.get("content-type"),
                greeting: context.greeting,
            };
            return response.json({ ok: true });
        },
    });
    createServiceRegistrar(app)(service);
    return app;
}

/** Sends one request through the application without a listener. */
function send(app: ReturnType<typeof buildApp>, path: string, text?: string): Promise<Response> {
    return Promise.resolve(
        app.fetch(
            new Request(`http://localhost${path}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                ...(text === undefined ? {} : { body: text }),
            }),
            { greeting: "hello" },
        ),
    );
}

describe("service request contract", () => {
    test("hands the handler its declared inputs, once each", async () => {
        const observed: Observed = { runs: 0 };
        const app = buildApp(observed);
        const text = '{ "value": "first" }';

        const response = await send(app, "/api/items/abc", text);

        expect(response.status).toBe(200);
        expect(observed.runs).toBe(1);
        expect(observed.request).toEqual({
            body: { value: "first" },
            bodyText: text,
            params: { itemId: "abc" },
            contentType: "application/json",
            greeting: "hello",
        });
    });

    test("rejects a missing, malformed, or schema-invalid body before the handler", async () => {
        for (const text of [undefined, "{", JSON.stringify({ value: 1 })]) {
            const observed: Observed = { runs: 0 };
            const app = buildApp(observed);

            const response = await send(app, "/api/items/abc", text);

            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ code: "invalid_request_body" });
            expect(observed.runs).toBe(0);
        }
    });

    test("rejects a path parameter that fails its declared schema before the handler", async () => {
        const observed: Observed = { runs: 0 };
        const app = buildApp(observed);

        const response = await send(app, "/api/items/no", JSON.stringify({ value: "first" }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "invalid_parameter" });
        expect(observed.runs).toBe(0);
    });
});
