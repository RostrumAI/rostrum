/** @fileoverview Private daemon HTTP routing and OpenAPI generation. */

import { join } from "node:path";
import { getLogger } from "@logtape/logtape";
import { type FeatureBundle, type LoadedFeature, loadFeatures } from "@rostrum/server/loader";
import { BoundaryErrorSchema } from "@rostrum/server/protocol";
import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, generateSpecs } from "hono-openapi";
import pkg from "../package.json" with { type: "json" };
import type { ServiceAccessor, Services } from "./services";

/** Feature discovery and OpenAPI generation do not acquire configuration or dependencies. */
export class DaemonApp {
    private readonly routes = new Hono<{ Bindings: Services }>();
    private readonly logger = getLogger("daemon");

    /** Loads and binds every private feature before listening. */
    static async create(): Promise<DaemonApp> {
        return new DaemonApp(
            await loadFeatures<ServiceAccessor>(join(import.meta.dir, "features")),
        );
    }

    private readonly loaded: FeatureBundle<ServiceAccessor>;

    private constructor(loaded: FeatureBundle<ServiceAccessor>) {
        this.loaded = loaded;
        this.routes.use("*", async (c, next) => {
            const started = performance.now();
            c.header("Cache-Control", "no-store");
            await next();
            this.logger.info("request completed", {
                method: c.req.method,
                path: c.req.path,
                status: c.res.status,
                durationMs: Math.round(performance.now() - started),
            });
        });
        for (const feature of loaded.features) {
            this.routes.on(
                feature.method,
                `/api${feature.path}`,
                describeRoute(this.describeFeature(feature)),
                feature.createHandler((context) => context.env),
            );
        }
        this.routes.get("/openapi.json", async (c) => c.json(await this.openApi()));
        const allowedByPath = new Map<string, string[]>();
        for (const route of this.routes.routes) {
            if (route.method === "ALL" || route.path.includes("*")) continue;
            const allowed = allowedByPath.get(route.path) ?? [];
            if (!allowed.includes(route.method)) allowed.push(route.method);
            if (route.method === "GET" && !allowed.includes("HEAD")) allowed.push("HEAD");
            allowedByPath.set(route.path, allowed);
        }
        // Fallback runs only after Hono has tried the actual routes, including HEAD-as-GET.
        this.routes.notFound((c) => {
            const allowed = allowedByPath.get(c.req.path);
            if (allowed) {
                c.header("Allow", allowed.join(", "));
                return c.json(
                    { code: "method_not_allowed", message: "Method not allowed", findings: [] },
                    405,
                );
            }
            return c.json({ code: "not_found", message: "Route not found", findings: [] }, 404);
        });
        this.routes.onError((_error, c) => {
            this.logger.error("handler failed", { method: c.req.method, path: c.req.path });
            return c.json(
                { code: "internal_error", message: "Internal Server Error", findings: [] },
                500,
            );
        });
    }

    /** The lifecycle authenticates and admits a request before invoking this method. */
    fetch(request: Request, services: Services): Response | Promise<Response> {
        return this.routes.fetch(request, services);
    }

    /** Generates the daemon's private OpenAPI document without service resources. */
    openApi(): Promise<Record<string, unknown>> {
        return generateSpecs(this.routes, {
            documentation: {
                openapi: "3.1.0",
                info: {
                    title: "Rostrum Daemon API",
                    version: pkg.version,
                    description: "Private authenticated daemon boundary.",
                },
                tags: [{ name: "system" }],
                security: [{ daemonBearer: [] }],
                components: {
                    schemas: { BoundaryError: BoundaryErrorSchema, ...this.loaded.components },
                    securitySchemes: { daemonBearer: { type: "http", scheme: "bearer" } },
                },
            },
        });
    }

    private describeFeature(feature: LoadedFeature<ServiceAccessor>): DescribeRouteOptions {
        const responses: NonNullable<DescribeRouteOptions["responses"]> = {
            "401": {
                description: "Bearer authentication required",
                content: {
                    "application/json": { schema: { $ref: "#/components/schemas/BoundaryError" } },
                },
            },
        };
        for (const [status, response] of Object.entries(feature.responses ?? {})) {
            responses[status] = {
                description: response.description,
                ...(response.schemaName === undefined
                    ? {}
                    : {
                          content: {
                              "application/json": {
                                  schema: { $ref: `#/components/schemas/${response.schemaName}` },
                              },
                          },
                      }),
            };
        }
        return { tags: [feature.tag], security: [{ daemonBearer: [] }], responses };
    }
}
