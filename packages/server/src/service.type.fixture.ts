/** @fileoverview Compile-time fixtures for the typed service contract. */

import type { Context as HonoContext } from "hono";
import { Type } from "typebox";
import {
    createServiceBuilder,
    type ServiceContext,
    type ServiceHandler,
    type ServiceRequest,
} from "./service";

/** Asserts that two types are identical. */
type Equal<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/** Fails to compile unless its argument is `true`. */
type Expect<T extends true> = T;

/** The application context the fixtures use, without the reserved `raw` field. */
interface FixtureContext {
    /** A handler-facing dependency, so context access is type-checked. */
    readonly database: {
        /** Stands in for a domain operation the handler calls. */
        readonly records: readonly string[];
    };
}

const bodySchema = Type.Object({ value: Type.String() });
const paramsSchema = Type.Object({ id: Type.String() });

const defineService = createServiceBuilder<FixtureContext, "system" | "workflows">();

/** Every declared input and every handler argument, inferred from one definition. */
export const withEverything = defineService({
    method: "POST",
    path: "/api/items/:id",
    request: { body: bodySchema, params: paramsSchema },
    openapi: { operationId: "createItem", summary: "Create an item", tags: ["workflows"] },
    responses: { 200: { description: "Created", body: bodySchema } },
    schemas: { Item: bodySchema },
    handler: (request, response, context) => {
        const { body, params, headers, bodyText } = request;
        const bodyCheck: Expect<Equal<typeof body, { value: string }>> = true;
        const paramsCheck: Expect<Equal<typeof params, { id: string }>> = true;
        const headersCheck: Expect<Equal<typeof headers, Headers>> = true;
        const textCheck: Expect<Equal<typeof bodyText, string>> = true;
        const recordsCheck: Expect<Equal<typeof context.database.records, readonly string[]>> =
            true;
        const rawCheck: Expect<Equal<typeof context.raw, HonoContext>> = true;

        if (
            !bodyCheck ||
            !paramsCheck ||
            !headersCheck ||
            !textCheck ||
            !recordsCheck ||
            !rawCheck
        ) {
            throw new Error("unreachable");
        }

        context.raw.req.method;
        return response.json({ id: params.id, value: body.value });
    },
});

/** A service that declares neither input: the request exposes only headers. */
export const withNothing = defineService({
    method: "GET",
    path: "/api/items",
    request: {},
    openapi: { operationId: "listItems", summary: "List items", tags: ["system"] },
    responses: { 200: { description: "The items" } },
    schemas: {},
    handler: (request, response) => {
        const headers: Headers = request.headers;
        void headers;
        return response.json({ ok: true });
    },
});

/** A bodyless service's request exposes headers only. */
export type BodylessRequestKeys = Expect<
    Equal<keyof ServiceRequest<undefined, undefined>, "headers">
>;

/** A context carries the application's own fields plus the reserved raw view, and nothing else. */
export type ContextKeys = Expect<Equal<keyof ServiceContext<FixtureContext>, "database" | "raw">>;

/** A handler answers with a response, never with a plain value. */
export type HandlerAnswer = Expect<
    Equal<
        ReturnType<ServiceHandler<FixtureContext, undefined, undefined>>,
        Response | Promise<Response>
    >
>;

/** A handler with the application's context and no declared inputs takes all three arguments. */
export type HandlerArity = Expect<
    Equal<Parameters<ServiceHandler<FixtureContext, undefined, undefined>>["length"], 3>
>;

/** An application context that declares the reserved raw field yields an error marker, not a builder. */
export type ReservedRawBuilder = Expect<
    Equal<
        ReturnType<typeof createServiceBuilder<{ raw: string }, "system">>,
        {
            readonly "the application context must not declare the reserved `raw` field; the framework provides it": never;
        }
    >
>;

/** Two path tokens must both be inferred, not collapsed by the wide declaration. */
export const withTwoParameters = defineService({
    method: "GET",
    path: "/api/items/:itemId/revisions/:revisionId",
    request: { params: Type.Object({ itemId: Type.String(), revisionId: Type.String() }) },
    openapi: { operationId: "getRevision", summary: "Read a revision", tags: ["system"] },
    responses: { 200: { description: "The revision" } },
    schemas: {},
    handler: (request, response) =>
        response.json({
            itemId: request.params.itemId,
            revisionId: request.params.revisionId,
        }),
});

/** The request a handler receives carries only the declared members. */
export type RequestKeys = Expect<
    Equal<
        keyof ServiceRequest<typeof bodySchema, typeof paramsSchema>,
        "headers" | "body" | "bodyText" | "params"
    >
>;

void withEverything;
void withNothing;
void withTwoParameters;
