/** @fileoverview Server application, registration, and request-boundary tests. */

import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { createServerApp, createServiceRegistrar, type ServerApp, serveOpenApi } from "./app";
import { createServiceBuilder, type ServiceBinding } from "./service";

/** The application context the tests serve requests with. */
interface TestContext {
    /** A handler-facing value, so context wiring is observable. */
    readonly greeting: string;
}

const defineService = createServiceBuilder<TestContext, "system">();

const itemSchema = Type.Object({ value: Type.String() });
const paramsSchema = Type.Object({ itemId: Type.String({ minLength: 3 }) });

/** Builds an application that records the order of its middleware and handler. */
function buildApp(trace: string[], handlerRuns: { count: number }) {
    const app = createServerApp<TestContext>({
        serviceName: "test-service",
        tags: ["system"],
        title: "Test API",
        description: "Test document.",
        version: "1.2.3",
    });

    app.hono.use("*", async (c, next) => {
        // The mandatory stack runs first, so the request id is already available.
        trace.push(`application:${String(c.get("requestId").length > 0)}`);
        await next();
    });

    const register = createServiceRegistrar(app);
    const createItem = defineService({
        method: "POST",
        path: "/api/items/:itemId",
        request: { body: itemSchema, params: paramsSchema },
        openapi: { operationId: "createItem", summary: "Create an item", tags: ["system"] },
        responses: { 200: { description: "The created item", body: itemSchema } },
        schemas: { Item: itemSchema },
        handler: (request, response, context) => {
            handlerRuns.count += 1;
            trace.push("handler");
            return response.json({
                value: request.body.value,
                itemId: request.params.itemId,
                greeting: context.greeting,
                sameContext: Object.is(context.raw, response),
            });
        },
    });
    register(createItem);
    serveOpenApi(app);
    return app;
}

/** Sends one request through the application without a listener. */
function send(
    app: ReturnType<typeof buildApp>,
    path: string,
    init?: RequestInit,
): Promise<Response> {
    return Promise.resolve(
        app.fetch(new Request(`http://localhost${path}`, init), { greeting: "hello" }),
    );
}

describe("server application", () => {
    test("runs the mandatory stack, then application middleware, then the handler", async () => {
        const trace: string[] = [];
        const app = buildApp(trace, { count: 0 });

        const response = await send(app, "/api/items/abc", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ value: "first" }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            value: "first",
            itemId: "abc",
            greeting: "hello",
            // `response` and `context.raw` are one object, not two views of a copy.
            sameContext: true,
        });
        // Application middleware observed the mandatory request id before the handler ran.
        expect(trace).toEqual(["application:true", "handler"]);
        expect(response.headers.get("x-request-id")).toBeTruthy();
    });

    test("rejects a missing, malformed, or schema-invalid body before the handler", async () => {
        for (const body of [undefined, "{", JSON.stringify({ value: 1 })]) {
            const runs = { count: 0 };
            const app = buildApp([], runs);
            const response = await send(app, "/api/items/abc", {
                method: "POST",
                headers: { "content-type": "application/json" },
                ...(body === undefined ? {} : { body }),
            });

            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ code: "invalid_request_body" });
            expect(runs.count).toBe(0);
        }
    });

    test("rejects a path parameter that fails its declared schema before the handler", async () => {
        const runs = { count: 0 };
        const app = buildApp([], runs);

        const response = await send(app, "/api/items/no", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ value: "first" }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "invalid_parameter" });
        expect(runs.count).toBe(0);
    });

    test("documents every registered service once", async () => {
        const app = buildApp([], { count: 0 });

        const document = await app.generateOpenApiDocument();
        const operation = (document.paths as Record<string, Record<string, unknown>>)[
            "/api/items/{itemId}"
        ]?.post as Record<string, unknown>;

        expect(document.info).toMatchObject({ title: "Test API", version: "1.2.3" });
        expect(operation.operationId).toBe("createItem");
        expect(operation.tags).toEqual(["system"]);
        expect(Object.keys(operation.responses as object)).toEqual(["200"]);
        expect(
            (document.components as { schemas: Record<string, unknown> }).schemas.Item,
        ).toBeDefined();
    });
});

describe("service registration", () => {
    /** Registers one binding on a fresh application and reports what it rejects. */
    function register(
        service: ServiceBinding<TestContext, string>,
        prepare?: (app: ServerApp<TestContext>) => void,
    ): void {
        const app = createServerApp<TestContext>({
            serviceName: "test-service",
            tags: ["system"],
            title: "Test API",
            description: "Test document.",
            version: "1.2.3",
        });
        prepare?.(app);
        createServiceRegistrar(app)(service);
    }

    /** A valid binding; each rejection case changes exactly one part of it. */
    const base: ServiceBinding<TestContext, string> = {
        method: "GET",
        path: "/api/things",
        request: {},
        openapi: { operationId: "listThings", summary: "List things", tags: ["system"] },
        responses: { 200: { description: "The things" } },
        schemas: {},
        serve: async () => Response.json({ ok: true }),
    };

    test("rejects a duplicate route, operation id, or undeclared tag", () => {
        expect(() =>
            register({ ...base, openapi: { ...base.openapi, operationId: "listOther" } }, (app) =>
                createServiceRegistrar(app)(base),
            ),
        ).toThrow(/already registered/);
        expect(() =>
            register({ ...base, path: "/api/other" }, (app) => createServiceRegistrar(app)(base)),
        ).toThrow(/operation id/);
        expect(() =>
            register({ ...base, openapi: { ...base.openapi, tags: ["unknown"] } }),
        ).toThrow(/does not declare the tag/);
    });

    test("rejects a body on a method that cannot carry one, and unmatched parameters", () => {
        expect(() => register({ ...base, request: { body: itemSchema } })).toThrow(
            /cannot carry a body/,
        );
        expect(() => register({ ...base, path: "/api/things/:thingId" })).toThrow(/undeclared/);
        expect(() => register({ ...base, request: { params: paramsSchema } })).toThrow(
            /not in the path/,
        );
        expect(() =>
            register({ ...base, request: { paramsDescriptions: { missing: "Not declared." } } }),
        ).toThrow(/undeclared/);
    });

    test("rejects a response whose schema is not a documented component", () => {
        expect(() =>
            register({
                ...base,
                responses: { 200: { description: "The things", body: itemSchema } },
            }),
        ).toThrow(/not a documented component/);
    });
});
