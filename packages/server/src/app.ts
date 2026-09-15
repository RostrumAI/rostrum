/** @fileoverview Branded server application: mandatory middleware, registration, and contract. */

import { getLogger, type Logger } from "@logtape/logtape";
import { Hono, type Context as HonoContext } from "hono";
import { requestId } from "hono/request-id";
import type { DescribeRouteOptions } from "hono-openapi";
import { describeRoute, generateSpecs } from "hono-openapi";
import type { TSchema } from "typebox";
import { decodeJsonBody, type ServiceBodyDecoder } from "./request";
import { type DefinedSchema, isDefinedSchema } from "./schema";
import { BODY_METHODS, type ServiceBinding, type ServiceResponseDefinition } from "./service";

/** Methods answered by 405 handlers: the HTTP standard set plus QUERY (RFC 9213). */
export const CANDIDATE_METHODS = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "TRACE",
    "QUERY",
] as const;

/** One declared operation of the generated contract. */
interface DocumentedResponse {
    /** Human-readable description of the outcome. */
    readonly description: string;
    /** The response body's schema: a component reference or an inline shape. */
    readonly content?: Record<string, { readonly schema: Record<string, unknown> }>;
}

/** A bearer-token security scheme the generated document declares. */
export interface BearerSecurityScheme {
    /** The HTTP authentication scheme. */
    readonly type: "http";
    /** Bearer tokens carry the credential. */
    readonly scheme: "bearer";
    /** Optional hint for how the token is formatted. */
    readonly bearerFormat?: string;
}

/** Everything `createServerApp` needs to build an application and its contract. */
export interface ServerAppOptions<Tag extends string = string> {
    /** Log category for this application's records. */
    readonly serviceName: string;
    /** The application's tag vocabulary; a service may only declare these tags. */
    readonly tags: readonly Tag[];
    /** Title of the generated OpenAPI document. */
    readonly title: string;
    /** Description of the generated OpenAPI document. */
    readonly description: string;
    /** Version of the generated OpenAPI document. */
    readonly version: string;
    /** Responses every operation documents, folded under the service's own. */
    readonly defaultResponses?: Record<string, ServiceResponseDefinition>;
    /** Security schemes the document declares. */
    readonly securitySchemes?: Record<string, BearerSecurityScheme>;
    /** Document-level security requirement, repeated on every operation. */
    readonly security?: readonly Record<string, readonly string[]>[];
    /** Decodes declared request bodies; defaults to the shared JSON decoder. */
    readonly decodeBody?: ServiceBodyDecoder;
}

/** One route's allowed methods, as the 405 handlers need them. */
export interface RouteTableEntry {
    /** The path this entry describes. */
    readonly path: string;
    /** The methods registered on that path, with HEAD paired to GET. */
    readonly methods: readonly string[];
}

/**
 * A registered Rostrum application. The class carries a private member, so a
 * bare Hono instance is not assignable: only `createServerApp` produces the
 * value a registrar or a production service accepts.
 */
export class ServerApp<Context extends object> {
    /** The Hono instance application middleware and services are bound to. */
    readonly hono: Hono<{ Bindings: Context }>;

    /** The private brand that keeps a bare Hono instance out of this position. */
    private declare readonly brand: never;

    private readonly tags: readonly string[];
    private readonly options: ServerAppOptions<string>;
    private readonly decodeBody: ServiceBodyDecoder;
    private readonly logger: Logger;
    private readonly componentOwners = new Map<string, TSchema>();
    private readonly operationIds = new Set<string>();
    private readonly operationPaths = new Set<string>();
    private document: Promise<Record<string, unknown>> | undefined;

    /** Builds an application with the mandatory middleware already installed. */
    constructor(options: ServerAppOptions<string>) {
        this.options = options;
        this.tags = options.tags;
        this.decodeBody = options.decodeBody ?? decodeJsonBody;
        this.logger = getLogger(options.serviceName);
        this.hono = new Hono<{ Bindings: Context }>();

        // Components the application documents on every operation, referenced by name.
        for (const response of Object.values(options.defaultResponses ?? {})) {
            this.contribute(response.body);
        }

        // Mandatory middleware first, so it wraps routes and application middleware.
        this.hono.use("*", requestId());
        this.hono.use("*", this.accessLog());
    }

    /** Records one request and its response without echoing bodies or credentials. */
    private accessLog(): (c: HonoContext, next: () => Promise<void>) => Promise<void> {
        return async (c, next) => {
            const started = Date.now();
            this.logger.debug("request received", { method: c.req.method, path: c.req.path });
            await next();
            this.logger.debug("response sent", {
                method: c.req.method,
                path: c.req.path,
                status: c.res.status,
                durationMs: Date.now() - started,
            });
        };
    }

    /**
     * Binds one declared service. Every conflict is a startup failure, so a
     * mistaken declaration never reaches a caller.
     */
    registerService(service: ServiceBinding<Context, string>): void {
        const route = `${service.method} ${service.path}`;
        if (this.operationPaths.has(route)) {
            throw new Error(`service conflict on ${route}: the route is already registered`);
        }
        if (this.operationIds.has(service.openapi.operationId)) {
            throw new Error(
                `service conflict on ${route}: operation id "${service.openapi.operationId}" is already used`,
            );
        }
        if (service.openapi.tags.length === 0) {
            throw new Error(`service conflict on ${route}: at least one tag is required`);
        }
        for (const tag of service.openapi.tags) {
            if (!this.tags.includes(tag)) {
                throw new Error(
                    `service conflict on ${route}: the application does not declare the tag "${tag}"`,
                );
            }
        }
        if (service.request.body !== undefined && !BODY_METHODS.includes(service.method)) {
            throw new Error(`service conflict on ${route}: ${service.method} cannot carry a body`);
        }
        this.checkParameters(service);

        // Documented bodies are the components this service contributes.
        this.contribute(service.request.body);
        for (const [status, response] of Object.entries(service.responses)) {
            if (!/^[1-5][0-9][0-9]$/.test(status)) {
                throw new Error(`service conflict on ${route}: "${status}" is not a status code`);
            }
            if (response.description.trim() === "") {
                throw new Error(
                    `service conflict on ${route}: response ${status} needs a description`,
                );
            }
            this.contribute(response.body);
        }

        this.operationIds.add(service.openapi.operationId);
        this.operationPaths.add(route);
        this.hono.on(
            service.method,
            service.path,
            describeRoute(this.describe(service)),
            (context: HonoContext<{ Bindings: Context }>) =>
                service.serve(context, context.env, this.decodeBody),
        );
    }

    /** Rejects a path whose tokens and declared parameter schema disagree. */
    private checkParameters(service: ServiceBinding<Context, string>): void {
        const route = `${service.method} ${service.path}`;
        const tokens = [...service.path.matchAll(/:([A-Za-z0-9_]+)/g)].map(
            (match) => match[1] ?? "",
        );
        const declared = Object.keys(service.request.params?.properties ?? {});
        for (const token of tokens) {
            if (!declared.includes(token)) {
                throw new Error(
                    `service conflict on ${route}: path parameter "${token}" is undeclared`,
                );
            }
        }
        for (const name of declared) {
            if (!tokens.includes(name)) {
                throw new Error(
                    `service conflict on ${route}: declared path parameter "${name}" is not in the path`,
                );
            }
        }
        for (const name of Object.keys(service.request.paramsDescriptions ?? {})) {
            if (!declared.includes(name)) {
                throw new Error(
                    `service conflict on ${route}: described path parameter "${name}" is undeclared`,
                );
            }
        }
    }

    /**
     * Registers one referenced component. The same name and the same schema may
     * arrive from several services; the same name with a different schema is a
     * conflict, so two services cannot silently disagree about a shared shape.
     */
    private contribute(reference: TSchema | DefinedSchema | undefined): void {
        if (reference === undefined || !isDefinedSchema(reference)) {
            return;
        }
        if (reference.name.trim() === "") {
            throw new Error("service conflict: a documented component needs a name");
        }
        const owner = this.componentOwners.get(reference.name);
        if (owner !== undefined && owner !== reference.schema) {
            throw new Error(
                `service conflict: component "${reference.name}" is already contributed`,
            );
        }
        this.componentOwners.set(reference.name, reference.schema);
    }

    /** The document's schema for one documented body: a reference or an inline shape. */
    private documentSchema(reference: TSchema | DefinedSchema): Record<string, unknown> {
        if (isDefinedSchema(reference)) {
            return { $ref: `#/components/schemas/${reference.name}` };
        }
        // The generator serializes an inline schema as written, so a schema that
        // carries no component name is documented where it is used.
        return reference as unknown as Record<string, unknown>;
    }

    /** Translates one service into the operation the contract documents. */
    private describe(service: ServiceBinding<Context, string>): DescribeRouteOptions {
        const responses: NonNullable<DescribeRouteOptions["responses"]> = {};
        for (const [status, response] of Object.entries({
            ...this.options.defaultResponses,
            ...service.responses,
        })) {
            responses[status] = this.describeResponse(service, response);
        }

        const description: DescribeRouteOptions = {
            operationId: service.openapi.operationId,
            summary: service.openapi.summary,
            tags: [...service.openapi.tags],
            responses,
        };
        if (this.options.security !== undefined) {
            description.security = this.securityRequirements();
        }
        const parameters = this.describeParameters(service);
        if (parameters.length > 0) {
            description.parameters = parameters;
        }
        if (service.request.body !== undefined) {
            description.requestBody = {
                required: true,
                description: service.request.bodyDescription ?? "The request body.",
                content: {
                    "application/json": { schema: this.documentSchema(service.request.body) },
                },
            };
        }
        return description;
    }

    /** Builds one documented response from its referenced or inline body schema. */
    private describeResponse(
        _service: ServiceBinding<Context, string>,
        response: ServiceResponseDefinition,
    ): DocumentedResponse {
        if (response.body === undefined) {
            return { description: response.description };
        }
        return {
            description: response.description,
            content: { "application/json": { schema: this.documentSchema(response.body) } },
        };
    }

    /** Builds the documented path parameters from the declared schema. */
    private describeParameters(
        service: ServiceBinding<Context, string>,
    ): NonNullable<DescribeRouteOptions["parameters"]> {
        const schema = service.request.params;
        if (schema === undefined) {
            return [];
        }
        return Object.entries(schema.properties).map(([name, property]) => ({
            name,
            in: "path" as const,
            required: true,
            description: service.request.paramsDescriptions?.[name] ?? name,
            schema: property as TSchema,
        }));
    }

    /** The methods registered on each path, for this application's 405 policy. */
    routeTable(): RouteTableEntry[] {
        const allowed = new Map<string, string[]>();
        for (const route of this.hono.routes) {
            // Middleware registers as an ALL-method wildcard; it is not an endpoint.
            if (route.method === "ALL" || route.path.includes("*")) {
                continue;
            }
            const methods = allowed.get(route.path) ?? [];
            if (!methods.includes(route.method)) {
                methods.push(route.method);
            }
            if (route.method === "GET" && !methods.includes("HEAD")) {
                methods.push("HEAD");
            }
            allowed.set(route.path, methods);
        }
        return [...allowed].map(([path, methods]) => ({ path, methods }));
    }

    /** The declared security requirement in the shape the generator expects. */
    private securityRequirements(): { [name: string]: string[] }[] {
        return (this.options.security ?? []).map((requirement) =>
            Object.fromEntries(
                Object.entries(requirement).map(([name, scopes]) => [name, [...scopes]]),
            ),
        );
    }

    /** Generates the OpenAPI document from the registered services. */
    generateOpenApiDocument(): Promise<Record<string, unknown>> {
        return generateSpecs(this.hono, {
            documentation: {
                openapi: "3.1.0",
                info: {
                    title: this.options.title,
                    version: this.options.version,
                    description: this.options.description,
                },
                tags: this.tags.map((name) => ({ name })),
                ...(this.options.security === undefined
                    ? {}
                    : { security: this.securityRequirements() }),
                components: {
                    // Sorted so the document is stable regardless of registration order.
                    schemas: Object.fromEntries(
                        [...this.componentOwners].sort(([left], [right]) =>
                            left.localeCompare(right),
                        ),
                    ),
                    ...(this.options.securitySchemes === undefined
                        ? {}
                        : { securitySchemes: this.options.securitySchemes }),
                },
            },
        }) as Promise<Record<string, unknown>>;
    }

    /**
     * Returns the document this application serves, generating it once. Every
     * registration has finished before a request arrives, so the route table
     * cannot change under the generated copy.
     */
    getOpenApiDocument(): Promise<Record<string, unknown>> {
        this.document ??= this.generateOpenApiDocument().catch((error: unknown) => {
            // Do not keep a failed generation: the next request tries again.
            this.document = undefined;
            throw error;
        });
        return this.document;
    }

    /** Serves one request with the application context supplied by the runtime. */
    fetch(request: Request, context: Context): Response | Promise<Response> {
        return this.hono.fetch(request, context);
    }
}

/** Creates an application with the mandatory middleware installed. */
export function createServerApp<Context extends object>(
    options: ServerAppOptions,
): ServerApp<Context> {
    return new ServerApp<Context>(options);
}

/**
 * Returns the registrar one application uses to bind its services. The
 * registrar refuses conflicting declarations at startup.
 */
export function createServiceRegistrar<Context extends object>(
    app: ServerApp<Context>,
): (service: ServiceBinding<Context, string>) => void {
    return (service) => app.registerService(service);
}

/**
 * Serves the generated contract. Call it after every service is registered.
 */
export function serveOpenApi<Context extends object>(app: ServerApp<Context>): void {
    app.hono.get("/openapi.json", async (c) => c.json(await app.getOpenApiDocument()));
}

/**
 * Answers every method a registered path does not allow with 405 and an
 * `Allow` header, so a wrong method is told what the path accepts. Call it
 * after every route is registered.
 */
export function registerMethodNotAllowed<Context extends object>(
    app: ServerApp<Context>,
    respond: (context: HonoContext, allowed: readonly string[]) => Response | Promise<Response>,
): void {
    for (const { path, methods } of app.routeTable()) {
        for (const method of CANDIDATE_METHODS) {
            if (methods.includes(method)) {
                continue;
            }
            app.hono.on(method, path, (c) => respond(c, methods));
        }
    }
}
