/** @fileoverview Control API configuration loading and database connection policy. */

import { type DatabaseOptions, validateDatabaseOptions } from "@rostrum/database";
import { type ControlApiConfig, ServiceConfigSource } from "@rostrum/server/config";

let source: ServiceConfigSource<"control-api"> | undefined;

/** Everything a caller needs to start the Control API: its configuration, and the database policy that configuration was validated against. */
export interface LoadedControlApiConfig {
    /** The validated configuration this process runs with. */
    config: ControlApiConfig;
    /** The database connection policy `config` was validated against; pass it straight to `createDatabase`. */
    databaseOptions: DatabaseOptions;
}

/**
 * Loads and validates process configuration.
 *
 * The startup environment and YAML file location are fixed at boot. Later
 * calls reparse that file while retaining environment-value precedence.
 */
export function loadConfig(): LoadedControlApiConfig {
    // First, select the Control API configuration source exactly once.
    source ??= new ServiceConfigSource("control-api");

    // Then, load the latest file values beneath the retained startup environment.
    const config = source.load();

    // Finally, derive the database connection policy and enforce it, so no caller
    // has to know how this service reaches its database.
    const databaseOptions: DatabaseOptions = {
        url: config.databaseUrl,
        tls: config.databaseTls,
        allowInsecureLocal: config.allowInsecureLocal,
        nodeEnv: config.nodeEnv,
        applicationName: "control-api",
        connectTimeoutMs: config.dependencyTimeoutMs,
    };
    validateDatabaseOptions(databaseOptions);
    return { config, databaseOptions };
}
