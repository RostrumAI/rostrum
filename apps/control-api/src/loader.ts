import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Handler } from "hono";
import type { TObject } from "typebox";

/** HTTP methods a feature route can bind to. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Route binding a feature module must export as `route`. The loader joins
 * `path` with the module's folder inside `src/features` and the `/api/v1`
 * prefix, so a module at `features/system/health.ts` with path `/health`
 * serves `GET /api/v1/system/health`.
 */
export interface FeatureRoute {
    method: HttpMethod;
    /** Path relative to the feature folder; starts with `/`. */
    path: string;
    /**
     * Documented responses keyed by status code. A response naming a
     * `schemaName` is documented with a `$ref` into the OpenAPI components.
     */
    responses?: Record<string, ResponseDefinition>;
}

/** One documented route response. */
export interface ResponseDefinition {
    description: string;
    /** Component name exported by this module's `schema` record. */
    schemaName?: string;
}

/** Named TypeBox schemas a feature module contributes (`schema`). */
export type FeatureSchemas = Record<string, TObject>;

/** Request handler for a feature route (`handler`). */
export type FeatureHandler = Handler;

/** The three exports every feature module must provide. */
export interface FeatureModule {
    route: FeatureRoute;
    schema?: FeatureSchemas;
    handler: FeatureHandler;
}

/** One validated feature ready to bind. */
export interface LoadedFeature {
    /** Module path relative to `src/features`, e.g. `system/health.ts`. */
    file: string;
    /** Route path under the versioned prefix, e.g. `/system/health`. */
    path: string;
    /** OpenAPI tag: the top-level folder inside `src/features`. */
    tag: string;
    method: HttpMethod;
    /** Documented responses keyed by status, as declared by the module. */
    responses: FeatureRoute["responses"];
    handler: FeatureHandler;
}

/** Validated features plus their contributed OpenAPI components. */
export interface FeatureBundle {
    features: LoadedFeature[];
    components: Record<string, TObject>;
}

const ROUTE_FILE_PATTERN = /\.ts$/;
const TEST_FILE_PATTERN = /\.test\.ts$/;

/**
 * Lists feature files under `dir` in deterministic order. Every `.ts` file
 * except colocated tests is a feature slice; there are no special names.
 */
function listFeatureFiles(dir: string): string[] {
    return readdirSync(dir, { recursive: true })
        .map((entry) => String(entry).split("\\").join("/"))
        .filter((file) => ROUTE_FILE_PATTERN.test(file) && !TEST_FILE_PATTERN.test(file))
        .sort();
}

/**
 * Checks one imported module against the {@link FeatureModule} shape and
 * returns its validated parts. Throws with the offending file named so a
 * misaligned slice fails startup instead of surfacing at request time.
 */
function validateModule(
    file: string,
    mod: unknown,
): {
    route: FeatureRoute;
    schema: FeatureSchemas;
    handler: FeatureHandler;
} {
    // An explicit variable type is required for TS to narrow via the never return.
    const fail: (reason: string) => never = (reason) => {
        throw new Error(`invalid feature ${file}: ${reason}`);
    };
    if (typeof mod !== "object" || mod === null || Array.isArray(mod)) {
        fail("module has no default object exports");
    }
    const candidate = mod as Record<string, unknown>;

    if (typeof candidate.handler !== "function") fail("must export a `handler` function");

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
            schema[name] = value as TObject;
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

    return { route: route as FeatureRoute, schema, handler: candidate.handler as FeatureHandler };
}

/**
 * Discovers and validates every feature slice under `featuresDir`. Each
 * module is dynamically imported and checked against the feature contract;
 * any missing or malformed export throws and prevents the process from
 * booting. Component names and bound paths must be unique across slices.
 */
export async function loadFeatures(featuresDir: string): Promise<FeatureBundle> {
    const features: LoadedFeature[] = [];
    const components: Record<string, TObject> = {};
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

        const { route, schema, handler } = validateModule(file, mod);
        const segments = file.split("/");
        const folderPath = segments
            .slice(0, -1)
            .map((segment) => `/${segment}`)
            .join("");

        const boundPath = `${folderPath}${route.path}`;
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
            handler,
        });
    }

    return { features, components };
}
