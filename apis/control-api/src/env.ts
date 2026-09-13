/** @fileoverview Control API configuration and database connection policy. */

import { type DatabaseOptions, validateDatabaseOptions } from "@rostrum/database";
import { type ControlApiConfig, ServiceConfigSource } from "@rostrum/server/config";

let source: ServiceConfigSource<"control-api"> | undefined;

/** The database options this service connects with; the pool and its probe share them. */
export function databaseOptions(config: ControlApiConfig): DatabaseOptions {
    return {
        url: config.databaseUrl,
        tls: config.databaseTls,
        allowInsecureLocal: config.allowInsecureLocal,
        nodeEnv: config.nodeEnv,
        applicationName: "control-api",
        connectTimeoutMs: config.dependencyTimeoutMs,
    };
}

/**
 * Loads and validates process configuration.
 *
 * The startup environment and YAML file location are fixed at boot. Later
 * calls reparse that file while retaining environment-value precedence.
 */
export function loadConfig(): ControlApiConfig {
    // First, select the Control API configuration source exactly once.
    source ??= new ServiceConfigSource("control-api");
    // Then, load the latest file values beneath the retained startup environment.
    const config = source.load();
    // Finally, enforce database connection policy before returning the complete config.
    validateDatabaseOptions(databaseOptions(config));
    return config;
}
