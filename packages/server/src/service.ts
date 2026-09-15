/** @fileoverview Typed service definitions: binding, schemas, OpenAPI metadata, and handler. */

import type { Context as HonoContext } from "hono";
import type { Static, TObject, TSchema } from "typebox";
import { type ServiceBodyDecoder, validatePathParameters } from "./request";

/** Methods a service route can bind to. */
export const SERVICE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** One method a service route binds to. */
export type ServiceMethod = (typeof SERVICE_METHODS)[number];

/** Methods whose services may declare a JSON request body. */
export const BODY_METHODS: readonly ServiceMethod[] = ["POST", "PUT", "PATCH"];

/** The OpenAPI tag vocabulary one application declares. */
export type ServiceTag = string;

/**
 * The request a service handler receives. `body` and `params` exist only when
 * the service declares the matching schema, so reading an undeclared member
 * does not type-check.
 */
export type ServiceRequest<Body extends TSchema | undefined, Params extends TSchema | undefined> = {
    /** The request's headers, as the web platform represents them. */
    readonly headers: Headers;
} & (Body extends undefined
    ? Record<never, never>
    : {
          /** The body, strictly decoded and validated against the declared schema. */
          readonly body: Static<Extract<Body, TSchema>>;
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
export type ServiceResponse = Pick<
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
 * The context a service handler receives: the application's own fields plus
 * `raw`, the original Hono context for everything `response` does not cover.
 */
export type ServiceContext<Context extends object> = Context & {
    /** The request-local Hono context backing `response`. */
    readonly raw: HonoContext;
};

/** The handler a service declares; all three arguments are inferred. */
export type ServiceHandler<
    Context extends object,
    Body extends TSchema | undefined,
    Params extends TSchema | undefined,
> = (
    request: ServiceRequest<Body, Params>,
    response: ServiceResponse,
    context: ServiceContext<Context>,
) => Response | Promise<Response>;

/** One documented response of a service operation. */
export interface ServiceResponseDefinition {
    /** Human-readable description surfaced in the generated contract. */
    description: string;
    /** The TypeBox schema the response body satisfies, contributed as a component. */
    body?: TSchema;
}

/** The OpenAPI metadata every service operation declares. */
export interface ServiceOpenApiDefinition<Tag extends string> {
    /** The operation's identifier, unique across the application. */
    operationId: string;
    /** Human-readable summary surfaced in the generated contract. */
    summary: string;
    /** The operation's tags; at least one, all declared by the application. */
    tags: readonly [Tag, ...Tag[]];
}

/** The input schemas a service declares. */
export interface ServiceRequestDefinition {
    /** JSON body schema; declaring it makes `request.body` available. */
    body?: TSchema;
    /** Path-parameter schema; declaring it makes `request.params` available. */
    params?: TObject;
    /** Path-parameter descriptions for the generated contract, keyed by token name. */
    paramsDescriptions?: Record<string, string>;
    /** Request-body description surfaced in the generated contract. */
    bodyDescription?: string;
}

/**
 * Binds one service to one request: reads the inputs the service declared,
 * then calls its handler. The builder closes over the handler, so the
 * registrar never needs the handler's argument types.
 */
export type ServiceBinder<Context extends object> = (
    hono: HonoContext,
    context: Context,
    decode: ServiceBodyDecoder,
) => Promise<Response>;

/**
 * The binding and metadata a registrar consumes: everything a declared
 * service carries except the handler, whose argument types stay in the
 * builder's closure.
 */
export interface ServiceBinding<Context extends object, Tag extends string = string> {
    /** The HTTP method the route binds to. */
    readonly method: ServiceMethod;
    /** The complete route path, starting with `/`. */
    readonly path: string;
    /** The schemas that derive this service's handler inputs. */
    readonly request: ServiceRequestDefinition;
    /** The operation's OpenAPI metadata. */
    readonly openapi: ServiceOpenApiDefinition<Tag>;
    /** Documented responses keyed by status code. */
    readonly responses: Record<string, ServiceResponseDefinition>;
    /** Named OpenAPI components this service contributes, keyed by component name. */
    readonly schemas: Record<string, TSchema>;
    /** Reads this service's declared inputs and calls its handler. */
    readonly serve: ServiceBinder<Context>;
}

/** One declared service: its binding plus the handler it declares. */
export interface ServiceDefinition<
    Context extends object = Record<string, never>,
    Tag extends string = string,
    Body extends TSchema | undefined = undefined,
    Params extends TSchema | undefined = undefined,
> extends ServiceBinding<Context, Tag> {
    /** The handler serving the route, with every argument inferred. */
    handler: ServiceHandler<Context, Body, Params>;
}

/** A `defineService` call's input shape before inference fills the handler. */
interface ServiceDefinitionInput<
    Context extends object,
    Tag extends string,
    Body extends TSchema | undefined,
    Params extends TSchema | undefined,
> {
    /** The HTTP method the route binds to. */
    method: ServiceMethod;
    /** The complete route path, starting with `/`. */
    path: string;
    /** The schemas that derive this service's handler inputs. */
    request: Omit<ServiceRequestDefinition, "body" | "params"> &
        (Body extends TSchema ? { body: Body } : { body?: undefined }) &
        (Params extends TSchema ? { params: Params } : { params?: undefined });
    /** The operation's OpenAPI metadata. */
    openapi: ServiceOpenApiDefinition<Tag>;
    /** Documented responses keyed by status code. */
    responses: Record<string, ServiceResponseDefinition>;
    /** Named OpenAPI components this service contributes, keyed by component name. */
    schemas: Record<string, TSchema>;
    /** The handler serving the route, with every argument inferred. */
    handler: ServiceHandler<Context, Body, Params>;
}

/**
 * The builder one application uses, generic over that application's context and
 * tag vocabulary. A context that declares the reserved `raw` field yields an
 * error marker instead of a callable builder, because the framework fills `raw`
 * with the original Hono context and an application must not shadow it.
 */
export type ServiceBuilder<
    Context extends object,
    Tag extends string = string,
> = "raw" extends keyof Context
    ? {
          readonly "the application context must not declare the reserved `raw` field; the framework provides it": never;
      }
    : <
          Body extends TSchema | undefined = undefined,
          Params extends TSchema | undefined = undefined,
      >(
          definition: ServiceDefinitionInput<Context, Tag, Body, Params>,
      ) => ServiceDefinition<Context, Tag, Body, Params>;

/**
 * Creates one application's service builder. The application fixes its context
 * type and its tag vocabulary, and every service in that application is
 * declared through the returned `defineService`, so handlers see the
 * application's own context fields.
 */
export function createServiceBuilder<
    Context extends object,
    Tag extends string = string,
>(): ServiceBuilder<Context, Tag> {
    /**
     * Declares one service. `body` and `params` are inferred from the declared
     * schemas, and the handler's three arguments follow from them.
     */
    function defineService<
        Body extends TSchema | undefined = undefined,
        Params extends TObject | undefined = undefined,
    >(
        definition: ServiceDefinitionInput<Context, Tag, Body, Params>,
    ): ServiceDefinition<Context, Tag, Body, Params> {
        const bodySchema = definition.request.body;
        const paramsSchema = definition.request.params;

        // Read the declared inputs once, then hand the handler one plain request
        // object. This closure is where the handler's inferred argument types are
        // known, so the registrar can bind the service without them.
        const serve: ServiceBinder<Context> = async (hono, context, decode) => {
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
            const response = hono as unknown as ServiceResponse;
            return await definition.handler(
                request as unknown as ServiceRequest<Body, Params>,
                response,
                { ...context, raw: hono } as ServiceContext<Context>,
            );
        };

        return { ...definition, serve };
    }

    // The conditional type above is the compile-time guard; the runtime value is
    // the same builder for every application context.
    return defineService as ServiceBuilder<Context, Tag>;
}
