import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Handler } from "hono";
import type { TSchema } from "typebox";

/** HTTP methods a feature route can bind to. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Route binding a feature module must export as `route`. The loader joins
 * `path` with the module's folder inside `src/features` and the `/api`
 * prefix, so a module at `features/system/health.ts` with path `/health`
 * serves `GET /api/system/health`. A module whose folder is the whole
 * route binds `path: "/"`; the collection route of a feature area.
 */
export interface FeatureRoute {
    method: HttpMethod;
    /** Path relative to the feature folder; starts with `/`, or exactly `/` for the folder route. */
    path: string;
    /**
     * Documented responses keyed by status code. A response naming a
     * `schemaName` is documented with a `$ref` into the OpenAPI components.
     */
    responses?: Record<string, ResponseDefinition>;
    /** Documented path and header parameters, surfaced in the generated contract. */
    parameters?: ParameterDefinition[];
    /** Documented request body, for operations that read one. */
    requestBody?: RequestBodyDefinition;
}

/** One documented route response. */
export interface ResponseDefinition {
    description: string;
    /** Component name exported by this module's `schema` record. */
    schemaName?: string;
}

export interface ParameterDefinition {
    /** Parameter name: a path token such as `workflowId`, or a header name. */
    name: string;
    /** Where the parameter travels. */
    in: "path" | "header";
    /** Whether the operation fails without it. Path parameters are always required. */
    required?: boolean;
    /** Human-readable description surfaced in the generated contract. */
    description: string;
    /** JSON Schema of the value; a TypeBox schema serializes directly. */
    schema?: TSchema;
}

/** One documented request body of a feature route. */
export interface RequestBodyDefinition {
    /** Human-readable description surfaced in the generated contract. */
    description: string;
    /** Whether the operation fails without a body. Default: true. */
    required?: boolean;
    /** Component name exported by this module's `schema` record for the body schema. */
    schemaName?: string;
}

/** Named TypeBox schemas a feature module contributes (`schema`). */
export type FeatureSchemas = Record<string, TSchema>;

/** Request handler for a feature route, as a factory returns it. */
export type FeatureHandler = Handler;

/**
 * Handler factory every feature module must export as `createHandler`.
 * The app builds its services once and calls the factory once per slice
 * at bind time, so handlers receive their dependencies instead of
 * reaching module state.
 */
export type FeatureHandlerFactory<S> = (services: S) => FeatureHandler;

/** The exports every feature module must provide. */
export interface FeatureModule<S> {
    route: FeatureRoute;
    schema?: FeatureSchemas;
    createHandler: FeatureHandlerFactory<S>;
}

/** One validated feature ready to bind. */
export interface LoadedFeature<S> {
    /** Module path relative to `src/features`, e.g. `system/health.ts`. */
    file: string;
    /** Route path under the `/api` prefix, e.g. `/system/health`. */
    path: string;
    /** OpenAPI tag: the top-level folder inside `src/features`. */
    tag: string;
    method: HttpMethod;
    /** Documented responses keyed by status, as declared by the module. */
    responses: FeatureRoute["responses"];
    /** Documented path and header parameters, as declared by the module. */
    parameters: ParameterDefinition[];
    /** Documented request body, as declared by the module. */
    requestBody: RequestBodyDefinition | undefined;
    /** The module's handler factory; the app calls it with its services. */
    createHandler: FeatureHandlerFactory<S>;
}

/** Validated features plus their contributed OpenAPI components. */
export interface FeatureBundle<S> {
    features: LoadedFeature<S>[];
    components: Record<string, TSchema>;
}

const ROUTE_FILE_PATTERN = /\.ts$/;
const TEST_FILE_PATTERN = /\.test\.ts$/;
const SCHEMA_FILE_PATTERN = /\.schema\.ts$/;

/**
 * Lists feature files under `dir` in deterministic order. Every `.ts`
 * file except colocated tests and `*.schema.ts` schema modules is a
 * feature slice; there are no other special names.
 */
function listFeatureFiles(dir: string): string[] {
    return readdirSync(dir, { recursive: true })
        .map((entry) => String(entry).split("\\").join("/"))
        .filter(
            (file) =>
                ROUTE_FILE_PATTERN.test(file) &&
                !TEST_FILE_PATTERN.test(file) &&
                !SCHEMA_FILE_PATTERN.test(file),
        )
        .sort();
}

/**
 * Checks one imported module against the {@link FeatureModule} shape and
 * returns its validated parts. Throws with the offending file named so a
 * misaligned slice fails startup instead of surfacing at request time.
 */
function validateModule<S>(
    file: string,
    mod: unknown,
): {
    route: FeatureRoute;
    schema: FeatureSchemas;
    createHandler: FeatureHandlerFactory<S>;
} {
    // An explicit variable type is required for TS to narrow via the never return.
    const fail: (reason: string) => never = (reason) => {
        throw new Error(`invalid feature ${file}: ${reason}`);
    };
    if (typeof mod !== "object" || mod === null || Array.isArray(mod)) {
        fail("module has no default object exports");
    }
    const candidate = mod as Record<string, unknown>;

    if (typeof candidate.createHandler !== "function") {
        fail("must export a `createHandler` factory function");
    }

    const route = candidate.route as Partial<FeatureRoute> | undefined;
    if (typeof route !== "object" || route === null || Array.isArray(route)) {
        fail("must export a `route` object");
    }
    if (!HTTP_METHODS.includes(route.method as HttpMethod)) {
        fail(`route.method must be one of ${HTTP_METHODS.join(", ")}, got ${String(route.method)}`);
    }
    if (typeof route.path !== "string" || !route.path.startsWith("/")) {
        fail("route.path must be a string starting with /");
    }

    const schema: FeatureSchemas = {};
    if (candidate.schema !== undefined) {
        if (
            typeof candidate.schema !== "object" ||
            candidate.schema === null ||
            Array.isArray(candidate.schema)
        ) {
            fail("`schema` must be an object of named schemas");
        }
        for (const [name, value] of Object.entries(candidate.schema)) {
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
                fail(`schema.${name} must be a TypeBox schema object`);
            }
            schema[name] = value as TSchema;
        }
    }

    for (const [status, response] of Object.entries(route.responses ?? {})) {
        if (
            typeof response !== "object" ||
            response === null ||
            typeof response.description !== "string"
        ) {
            fail(`route.responses.${status} needs a description`);
        }
        if (response.schemaName !== undefined && !(response.schemaName in schema)) {
            fail(
                `route.responses.${status} references schema "${response.schemaName}" but the module does not export it`,
            );
        }
    }

    if (route.parameters !== undefined) {
        if (!Array.isArray(route.parameters)) fail("route.parameters must be an array");
        route.parameters.forEach((parameter, index) => {
            if (typeof parameter !== "object" || parameter === null || Array.isArray(parameter)) {
                fail(`route.parameters.${index} must be an object`);
            }
            if (typeof parameter.name !== "string" || parameter.name === "") {
                fail(`route.parameters.${index}.name must be a non-empty string`);
            }
            if (parameter.in !== "path" && parameter.in !== "header") {
                fail(`route.parameters.${index}.in must be "path" or "header"`);
            }
            if (typeof parameter.description !== "string") {
                fail(`route.parameters.${index}.description must be a string`);
            }
            if (parameter.in === "path" && parameter.required === false) {
                fail(`route.parameters.${index}: a path parameter cannot be optional`);
            }
        });
    }

    if (route.requestBody !== undefined) {
        if (typeof route.requestBody !== "object" || route.requestBody === null) {
            fail("route.requestBody must be an object");
        }
        if (typeof route.requestBody.description !== "string") {
            fail("route.requestBody.description must be a string");
        }
        if (
            route.requestBody.schemaName !== undefined &&
            !(route.requestBody.schemaName in schema)
        ) {
            fail(
                `route.requestBody references schema "${route.requestBody.schemaName}" but the module does not export it`,
            );
        }
    }

    return {
        route: route as FeatureRoute,
        schema,
        createHandler: candidate.createHandler as FeatureHandlerFactory<S>,
    };
}

/**
 * Discovers and validates every feature slice under `featuresDir`. Each
 * module is dynamically imported and checked against the feature contract;
 * any missing or malformed export throws and prevents the process from
 * booting. Component names and bound paths must be unique across slices.
 */
export async function loadFeatures<S>(featuresDir: string): Promise<FeatureBundle<S>> {
    const features: LoadedFeature<S>[] = [];
    const components: Record<string, TSchema> = {};
    const seenPaths = new Map<string, string>();
    const seenComponents = new Map<string, string>();

    for (const file of listFeatureFiles(featuresDir)) {
        // Static imports cannot express these modules: the file set is discovered
        // by scanning src/features at boot, so every specifier is runtime-selected.
        let mod: unknown;
        try {
            mod = await import(pathToFileURL(join(featuresDir, file)).href);
        } catch (error) {
            throw new Error(`failed to import feature ${file}: ${(error as Error).message}`);
        }

        const { route, schema, createHandler } = validateModule<S>(file, mod);
        const segments = file.split("/");
        const folderPath = segments
            .slice(0, -1)
            .map((segment) => `/${segment}`)
            .join("");

        const boundPath = route.path === "/" ? folderPath : `${folderPath}${route.path}`;
        const previousFile = seenPaths.get(boundPath);
        if (previousFile !== undefined) {
            throw new Error(
                `feature path conflict on ${boundPath}: ${previousFile} and ${file} both bind it`,
            );
        }
        seenPaths.set(boundPath, file);

        for (const [name, component] of Object.entries(schema)) {
            const owner = seenComponents.get(name);
            if (owner !== undefined) {
                // Feature areas share schemas (every workflow route documents
                // the same error shape): the identical object contributed
                // again is the same component, not a conflict.
                if (components[name] === component) continue;
                throw new Error(
                    `component name conflict on "${name}": ${owner} and ${file} both export it`,
                );
            }
            seenComponents.set(name, file);
            components[name] = component;
        }

        features.push({
            file,
            path: boundPath,
            tag: segments[0] ?? "",
            method: route.method as HttpMethod,
            responses: route.responses,
            parameters: route.parameters ?? [],
            requestBody: route.requestBody,
            createHandler,
        });
    }

    return { features, components };
}
