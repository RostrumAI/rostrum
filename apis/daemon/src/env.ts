import { type DatabaseOptions, validateDatabaseOptions } from "@rostrum/database";
import { type DaemonConfig, ServiceConfigSource } from "@rostrum/server/config";

let source: ServiceConfigSource<"daemon"> | undefined;

export function databaseOptions(config: DaemonConfig): DatabaseOptions {
    return {
        url: config.databaseUrl,
        tlsMode: config.databaseTlsMode,
        allowInsecureLocal: config.allowInsecureLocal,
        nodeEnv: config.nodeEnv,
        applicationName: "daemon",
        connectTimeoutMs: config.dependencyTimeoutMs,
    };
}

export function loadConfig(): DaemonConfig {
    source ??= new ServiceConfigSource("daemon");
    const config = source.load();
    validateDatabaseOptions(databaseOptions(config));
    return config;
}
