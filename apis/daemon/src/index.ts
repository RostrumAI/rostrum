import type { DaemonConfig } from "@rostrum/server/config";
import { runService } from "@rostrum/server/lifecycle";
import { authenticate } from "./auth";
import { loadConfig } from "./env";
import { createDependencies, type Dependencies, readiness } from "./services";

/**
 * The daemon process. Configuration and token material are validated before
 * any dependency is acquired; requests are authenticated before the draining
 * gate and every other boundary concern.
 */
await runService<DaemonConfig, Dependencies>({
    name: "daemon",
    loadConfig,
    createDependencies,
    authenticate,
    readiness,
    fetch: (request, config, dependencies, signal) =>
        dependencies.app.fetch(request, {
            database: dependencies.database,
            config,
            signal,
        }),
});
