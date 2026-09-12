import type { ControlApiConfig } from "@rostrum/server/config";
import { runService } from "@rostrum/server/lifecycle";
import { loadConfig } from "./env";
import { createDependencies, type Dependencies, readiness } from "./services";

/**
 * The Control API process. Configuration is resolved and validated before any
 * resource is acquired, and each request is served from the snapshot it was
 * admitted with, so a SIGHUP reload never changes dependencies underneath it.
 */
await runService<ControlApiConfig, Dependencies>({
    name: "control-api",
    loadConfig,
    createDependencies,
    readiness,
    fetch: (request, config, dependencies) =>
        dependencies.app.fetch(request, {
            workflows: dependencies.workflows,
            // Resolved from the request's own snapshot: a token-only reload
            // swaps the token set without rebuilding dependencies, so binding
            // this at dependency creation would keep sending the retired token.
            readiness: (signal) => readiness(config, dependencies, signal),
        }),
});
