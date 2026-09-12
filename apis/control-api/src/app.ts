import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import { getLogger } from "@logtape/logtape";
import {
    type FeatureBundle,
    type FeatureRoute,
    type LoadedFeature,
    loadFeatures,
    type RequestBodyDefinition,
    type ResponseDefinition,
} from "@rostrum/server/loader";
import { type Context, Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, generateSpecs } from "hono-openapi";
import pkg from "../package.json" with { type: "json" };
import { accessLog } from "./middleware/access-log";
import { parameterGuard } from "./parameter-guard";
import { ErrorResponseSchema } from "./schemas";
import type { Services } from "./services";
import { FindingSchema } from "./workflows/schemas";

/** Path prefix every feature route mounts under. */
const API_PREFIX = "/api";

/**
 * Components shared across features. The TypeBox schemas are embedded
 * verbatim, so the generated document round-trips them unchanged.
 */
const SHARED_COMPONENTS = {
    ErrorResponse: ErrorResponseSchema,
    Finding: FindingSchema,
} as const;

/** Methods checked for 405 responses (HTTP standard set plus QUERY, RFC 9213). */
const CANDIDATE_METHODS = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "TRACE",
    "QUERY",
] as const;

/**
 * Control API application.
 *
 * Routes are mounted on a plain Hono app so tests can drive `routes.fetch()`
 * without a socket and the real process serves the same app over HTTP.
 * Route slices under `src/features` bind themselves at construction: the
 * folder layout decides the path, so a slice never edits a central route
 * table.
 *
 * Construction acquires no resources: the app holds no pool and performs no
 * probe, so OpenAPI generation and route tests run offline. Each request
 * supplies the services it borrows, resolved through request-scoped storage
 * so concurrent requests never observe one another's snapshot.
 */
export class ControlApiApp {
    /** The mounted Hono application; serve it with Bun.serve or fetch it directly. */
    readonly routes = new Hono();

    private readonly logger = getLogger("control-api");

    /** Request-scoped services; empty outside a served request. */
    private readonly services = new AsyncLocalStorage<Services>();

    /**
     * The services view handed to feature factories at bind time. Handlers
     * read it while serving, when request-scoped storage holds the snapshot
     * the request was admitted with.
     */
    private readonly activeServices: Services;

    private readonly loaded: FeatureBundle<Services>;

    /**
     * Builds the app from the feature slices under `src/features`. Every slice
     * is validated against the feature contract here, before anything serves
     * traffic; no dependency is acquired.
     */
    static async create(): Promise<ControlApiApp> {
        return new ControlApiApp(await loadFeatures<Services>(join(import.meta.dir, "features")));
    }

    /**
     * Serves one request against the services snapshot it was admitted with.
     * Omitting the snapshot serves routes that borrow nothing (health, the
     * generated contract) without any resource; a route that does borrow
     * throws, because no snapshot is live.
     */
    fetch(request: Request, services?: Services): Response | Promise<Response> {
        if (services === undefined) return this.routes.fetch(request);
        return this.services.run(services, () => this.routes.fetch(request));
    }

    /** The generated OpenAPI document, without serving or acquiring anything. */
    async openApi(): Promise<Response> {
        return this.routes.fetch(new Request("http://localhost/openapi.json"));
    }

    private constructor(loaded: FeatureBundle<Services>) {
        this.loaded = loaded;
        // Capture the storage instance in a local: `this` inside an object
        // literal's getter is the literal, not the app instance.
        const storage = this.services;
        this.activeServices = {
            get workflows() {
                const active = storage.getStore();
                if (active === undefined) {
                    throw new Error("workflow services are only available while serving a request");
                }
                return active.workflows;
            },
            get readiness() {
                const active = storage.getStore();
                if (active === undefined) {
                    throw new Error("readiness is only available while serving a request");
                }
                return active.readiness;
            },
        };

        // Registered first so it wraps every route, including 404 responses.
        this.routes.use("*", accessLog());
        for (const feature of this.loaded.features) {
            this.routes.on(
                feature.method,
                `${API_PREFIX}${feature.path}`,
                describeRoute(this.describeFeature(feature)),
                parameterGuard(feature.parameters),
                feature.createHandler(this.activeServices),
            );
        }

        this.routes.get("/openapi.json", async (c) => {
            const doc = await generateSpecs(
                this.routes,
                {
                    documentation: {
                        openapi: "3.1.0",
                        info: {
                            title: "Rostrum Control API",
                            version: pkg.version,
                            description:
                                "Code-first OpenAPI 3.1 document generated from TypeBox schemas.",
                        },
                        tags: [{ name: "system" }],
                        components: {
                            schemas: { ...SHARED_COMPONENTS, ...this.loaded.components },
                        },
                    },
                },
                c,
            );
            return c.json(doc);
        });

        this.routes.notFound((c) => this.notFound(c));
        this.routes.onError((err, c) => this.serverError(err, c));
        // Must run after all routes are registered (the error contract).
        this.registerMethodNotAllowed();
    }

    /**
     * Builds the hono-openapi documentation for one bound feature. The tag is
     * the feature area folder; each documented response references its module
     * component by name. Used for building OpenAPI JSON output.
     */
    private describeFeature(feature: LoadedFeature<Services>): DescribeRouteOptions {
        const description: DescribeRouteOptions = {
            tags: [feature.tag],
            responses: this.describeResponses(feature.responses),
        };

        if (feature.parameters.length > 0) {
            description.parameters = feature.parameters.map((parameter) => ({
                name: parameter.name,
                in: parameter.in,
                required: parameter.required ?? parameter.in === "path",
                description: parameter.description,
                ...(parameter.schema === undefined ? {} : { schema: parameter.schema }),
            }));
        }

        if (feature.requestBody !== undefined) {
            description.requestBody = this.describeRequestBody(feature.requestBody);
        }

        return description;
    }

    /**
     * Builds the documented responses, referencing each named component.
     * Used for building OpenAPI JSON output.
     */
    private describeResponses(
        responses: FeatureRoute["responses"],
    ): NonNullable<DescribeRouteOptions["responses"]> {
        const described: NonNullable<DescribeRouteOptions["responses"]> = {};
        const declared: Record<string, ResponseDefinition> = responses ?? {};
        for (const [status, response] of Object.entries(declared)) {
            if (response.schemaName === undefined) {
                described[status] = { description: response.description };
            } else {
                described[status] = {
                    description: response.description,
                    content: {
                        "application/json": {
                            schema: { $ref: `#/components/schemas/${response.schemaName}` },
                        },
                    },
                };
            }
        }
        return described;
    }

    /**
     * Builds the documented request body, referencing its named component.
     * Used for building OpenAPI JSON output.
     */
    private describeRequestBody(
        requestBody: RequestBodyDefinition,
    ): DescribeRouteOptions["requestBody"] {
        if (requestBody.schemaName === undefined) {
            return {
                required: requestBody.required ?? true,
                description: requestBody.description,
                content: { "application/json": { schema: {} } },
            };
        }
        return {
            required: requestBody.required ?? true,
            description: requestBody.description,
            content: {
                "application/json": {
                    schema: { $ref: `#/components/schemas/${requestBody.schemaName}` },
                },
            },
        };
    }

    /**
     * One error response in the single error shape:
     * `{ code, message, findings }`. `findings` stays empty until the
     * workflow operations report validation findings.
     */
    private errorJson(
        code: string,
        message: string,
    ): { code: string; message: string; findings: [] } {
        return { code, message, findings: [] };
    }

    /** Unknown route or path: 404 with the error shape. */
    private notFound(c: Context): Response {
        return c.json(
            this.errorJson("not_found", `No route for ${c.req.method} ${c.req.path}`),
            404,
        );
    }

    /** Known path, disallowed method: 405 with an `Allow` header. */
    private methodNotAllowed(c: Context, allowed: readonly string[]): Response {
        c.header("Allow", allowed.join(", "));
        return c.json(
            this.errorJson(
                "method_not_allowed",
                `${c.req.method} is not allowed for ${c.req.path}`,
            ),
            405,
        );
    }

    /** Unhandled handler error: 500 with the error shape, always logged. */
    private serverError(err: Error, c: Context): Response {
        this.logger.error("handler failed", { error: String(err), path: c.req.path });
        return c.json(this.errorJson("internal_error", "Internal Server Error"), 500);
    }

    /**
     * Registers 405 handlers for every registered route path and every candidate
     * method the path does not allow. The allowed-method table is derived from
     * `routes`, which Hono flattens across `route(...)` mounts, so future routes
     * get 405 handling without a manual table. HEAD is paired with GET: Hono
     * dispatches HEAD by mapping it to GET, and the Allow header should state
     * that.
     *
     * Must run after all routes are registered.
     */
    private registerMethodNotAllowed(): void {
        const allowedByPath = new Map<string, string[]>();
        for (const route of this.routes.routes) {
            // Middleware registers as an ALL-method wildcard; it is not an
            // endpoint and must not seed wildcard 405 handlers.
            if (route.method === "ALL" || route.path.includes("*")) continue;
            const allowed = allowedByPath.get(route.path) ?? [];
            if (!allowed.includes(route.method)) allowed.push(route.method);
            if (route.method === "GET" && !allowed.includes("HEAD")) allowed.push("HEAD");
            allowedByPath.set(route.path, allowed);
        }
        for (const [path, allowed] of allowedByPath) {
            for (const method of CANDIDATE_METHODS) {
                if (allowed.includes(method)) continue;
                this.routes.on(method, path, (c) => this.methodNotAllowed(c, allowed));
            }
        }
    }
}
