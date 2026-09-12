import { type DatabaseOptions, validateDatabaseOptions } from "@rostrum/database";
import { type ControlApiConfig, ServiceConfigSource } from "@rostrum/server/config";

let source: ServiceConfigSource<"control-api"> | undefined;

/** The database options this service connects with; the pool and its probe share them. */
export function databaseOptions(config: ControlApiConfig): DatabaseOptions {
    return {
        url: config.databaseUrl,
        tlsMode: config.databaseTlsMode,
        allowInsecureLocal: config.allowInsecureLocal,
        nodeEnv: config.nodeEnv,
        applicationName: "control-api",
        connectTimeoutMs: config.dependencyTimeoutMs,
    };
}

/**
 * Loads and validates the process configuration. The source retains the
 * startup environment and the selected file, so a SIGHUP reload rereads the
 * same files with environment values still taking precedence.
 *
 * Database options are validated here, before any pool is opened, so an
 * unsafe transport policy fails the process rather than a later connection.
 */
export function loadConfig(): ControlApiConfig {
    source ??= new ServiceConfigSource("control-api");
    const config = source.load();
    validateDatabaseOptions(databaseOptions(config));
    return config;
}
