/** @fileoverview Typed controller definitions: binding, schemas, OpenAPI metadata, and handler. */

import type { Context as HonoContext } from "hono";
import type { Static, TObject, TSchema } from "typebox";
import { type ControllerBodyDecoder, validatePathParameters } from "./request";
import { type DefinedSchema, schemaOf } from "./schema";

/** Methods a controller route can bind to. */
export const CONTROLLER_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** One method a controller route binds to. */
export type ControllerMethod = (typeof CONTROLLER_METHODS)[number];

/** Methods whose controllers may declare a JSON request body. */
export const BODY_METHODS: readonly ControllerMethod[] = ["POST", "PUT", "PATCH"];

/** The value a declared body produces, whether it was named as a component or not. */
type BodyValue<Body> =
    Body extends DefinedSchema<infer Schema>
        ? Static<Schema>
        : Body extends TSchema
          ? Static<Body>
          : never;

/**
 * The request a controller handler receives. `body` and `params` exist only when
 * the controller declares the matching schema, so reading an undeclared member
 * does not type-check.
 */
export type ControllerRequest<
    Body extends TSchema | DefinedSchema | undefined,
    Params extends TSchema | undefined,
> = {
    /** The request's headers, as the web platform represents them. */
    readonly headers: Headers;
} & (Body extends undefined
    ? Record<never, never>
    : {
          /** The body, strictly decoded and validated against the declared schema. */
          readonly body: BodyValue<Body>;
          /**
           * The body's exact source text, kept for operations that store or
           * re-anchor to the bytes the author sent.
           */
          readonly bodyText: string;
      }) &
    (Params extends undefined
        ? Record<never, never>
        : {
              /** The path parameters, validated against the declared schema. */
              readonly params: Static<Extract<Params, TSchema>>;
          });

/**
 * The response view of the request-local Hono context. The registrar hands
 * over the same context object rather than copying or rebinding methods, so
 * `response` and `context.raw` stay two views of one object.
 */
export type ControllerResponse = Pick<
    HonoContext,
    | "header"
    | "status"
    | "newResponse"
    | "body"
    | "text"
    | "json"
    | "html"
    | "redirect"
    | "notFound"
    | "render"
    | "setRenderer"
    | "setLayout"
    | "getLayout"
>;

/**
 * The context a controller handler receives: the application's own fields plus
 * `raw`, the original Hono context for everything `response` does not cover.
 */
export type ControllerContext<Context extends object> = Context & {
    /** The request-local Hono context backing `response`. */
    readonly raw: HonoContext;
};

/** The handler a controller declares; all three arguments are inferred. */
export type Controller<
    Context extends object,
    Body extends TSchema | DefinedSchema | undefined,
    Params extends TSchema | undefined,
> = (
    request: ControllerRequest<Body, Params>,
    response: ControllerResponse,
    context: ControllerContext<Context>,
) => Response | Promise<Response>;

/** One documented response of a controller operation. */
export interface ControllerResponseDefinition {
    /** Human-readable description surfaced in the generated contract. */
    description: string;
    /** The response body's schema: a named component, or an inline shape. */
    body?: TSchema | DefinedSchema;
}

/** The OpenAPI metadata every controller operation declares. */
export interface ControllerOpenApiDefinition<Tag extends string> {
    /** The operation's identifier, unique across the application. */
    operationId: string;
    /** Human-readable summary surfaced in the generated contract. */
    summary: string;
    /** The operation's tags; at least one, all declared by the application. */
    tags: readonly [Tag, ...Tag[]];
}

/** The input schemas a controller declares. */
export interface ControllerRequestDefinition {
    /** JSON body schema; declaring it makes `request.body` available. */
    body?: TSchema | DefinedSchema;
    /** Path-parameter schema; declaring it makes `request.params` available. */
    params?: TObject;
    /** Path-parameter descriptions for the generated contract, keyed by token name. */
    paramsDescriptions?: Record<string, string>;
    /** Request-body description surfaced in the generated contract. */
    bodyDescription?: string;
}

/**
 * Binds one controller to one request: reads the inputs the controller declared,
 * then calls its handler. The builder closes over the handler, so the
 * registrar never needs the handler's argument types.
 */
export type ControllerBinder<Context extends object> = (
    hono: HonoContext,
    context: Context,
    decode: ControllerBodyDecoder,
) => Promise<Response>;

/**
 * The binding and metadata a registrar consumes: everything a declared
 * controller carries except the handler, whose argument types stay in the
 * builder's closure.
 */
export interface ControllerBinding<Context extends object, Tag extends string = string> {
    /** The HTTP method the route binds to. */
    readonly method: ControllerMethod;
    /** The complete route path, starting with `/`. */
    readonly path: string;
    /** The schemas that derive this controller's handler inputs. */
    readonly request: ControllerRequestDefinition;
    /** The operation's OpenAPI metadata. */
    readonly openapi: ControllerOpenApiDefinition<Tag>;
    /** Documented responses keyed by status code. */
    readonly responses: Record<string, ControllerResponseDefinition>;
    /** Reads this controller's declared inputs and calls its handler. */
    readonly serve: ControllerBinder<Context>;
}

/** One declared controller: its binding plus the handler it declares. */
export interface ControllerDefinition<
    Context extends object = Record<string, never>,
    Tag extends string = string,
    Body extends TSchema | DefinedSchema | undefined = undefined,
    Params extends TSchema | undefined = undefined,
> extends ControllerBinding<Context, Tag> {
    /** The handler serving the route, with every argument inferred. */
    handler: Controller<Context, Body, Params>;
}

/** A `defineController` call's input shape before inference fills the handler. */
interface ControllerDefinitionInput<
    Context extends object,
    Tag extends string,
    Body extends TSchema | DefinedSchema | undefined,
    Params extends TSchema | undefined,
> {
    /** The HTTP method the route binds to. */
    method: ControllerMethod;
    /** The complete route path, starting with `/`. */
    path: string;
    /** The schemas that derive this controller's handler inputs. */
    request: {
        /** JSON body schema; declaring it makes `request.body` available. */
        body?: Body;
        /** Path-parameter schema; declaring it makes `request.params` available. */
        params?: Params;
        /** Path-parameter descriptions for the generated contract, keyed by token name. */
        paramsDescriptions?: Record<string, string>;
        /** Request-body description surfaced in the generated contract. */
        bodyDescription?: string;
    };
    /** The operation's OpenAPI metadata. */
    openapi: ControllerOpenApiDefinition<Tag>;
    /** Documented responses keyed by status code. */
    responses: Record<string, ControllerResponseDefinition>;
    /** The handler serving the route, with every argument inferred. */
    handler: Controller<Context, Body, Params>;
}

/**
 * The builder one application uses, generic over that application's context and
 * tag vocabulary. A context that declares the reserved `raw` field yields an
 * error marker instead of a callable builder, because the framework fills `raw`
 * with the original Hono context and an application must not shadow it.
 */
export type ControllerBuilder<
    Context extends object,
    Tag extends string = string,
> = "raw" extends keyof Context
    ? {
          readonly "the application context must not declare the reserved `raw` field; the framework provides it": never;
      }
    : <
          Body extends TSchema | DefinedSchema | undefined = undefined,
          Params extends TSchema | undefined = undefined,
      >(
          definition: ControllerDefinitionInput<Context, Tag, Body, Params>,
      ) => ControllerDefinition<Context, Tag, Body, Params>;

/**
 * Creates one application's controller builder. The application fixes its context
 * type and its tag vocabulary, and every controller in that application is
 * declared through the returned `defineController`, so handlers see the
 * application's own context fields.
 */
export function createControllerBuilder<
    Context extends object,
    Tag extends string = string,
>(): ControllerBuilder<Context, Tag> {
    /**
     * Declares one controller. `body` and `params` are inferred from the declared
     * schemas, and the handler's three arguments follow from them.
     */
    function defineController<
        Body extends TSchema | DefinedSchema | undefined = undefined,
        Params extends TObject | undefined = undefined,
    >(
        definition: ControllerDefinitionInput<Context, Tag, Body, Params>,
    ): ControllerDefinition<Context, Tag, Body, Params> {
        const bodyReference = definition.request.body;
        const bodySchema = bodyReference === undefined ? undefined : schemaOf(bodyReference);
        const paramsSchema = definition.request.params;

        // Read the declared inputs once, then hand the handler one plain request
        // object. This closure is where the handler's inferred argument types are
        // known, so the registrar can bind the controller without them.
        const serve: ControllerBinder<Context> = async (hono, context, decode) => {
            const request: Record<string, unknown> = { headers: hono.req.raw.headers };

            if (bodySchema !== undefined) {
                const decoded = await decode(hono.req.raw, bodySchema);
                if (!decoded.ok) {
                    return decoded.response;
                }
                request.body = decoded.decoded.body;
                request.bodyText = decoded.decoded.text;
            }

            if (paramsSchema !== undefined) {
                const validated = validatePathParameters(paramsSchema, (name) =>
                    hono.req.param(name),
                );
                if (!validated.ok) {
                    return validated.response;
                }
                request.params = validated.params;
            }

            // `response` and `context.raw` are the same request-local Hono context
            // viewed two ways, so no method is copied or rebound.
            const response = hono as unknown as ControllerResponse;
            return await definition.handler(
                request as unknown as ControllerRequest<Body, Params>,
                response,
                { ...context, raw: hono } as ControllerContext<Context>,
            );
        };

        return { ...definition, serve };
    }

    // The conditional type above is the compile-time guard; the runtime value is
    // the same builder for every application context.
    return defineController as ControllerBuilder<Context, Tag>;
}
