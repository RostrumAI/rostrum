/** @fileoverview Control API process entry point. */

import { type ControlApiConfig, ServiceConfigSource } from "@rostrum/server/config";
import { runService } from "@rostrum/server/lifecycle";
import { createDependencies, type Dependencies, readiness } from "./services";

/** Starts the Control API with reloadable configuration and owned dependencies. */
const config = new ServiceConfigSource("control-api");
await runService<ControlApiConfig, Dependencies>({
    name: "control-api",
    loadConfig: () => config.load(),
    createDependencies,
    fetch: (request, config, dependencies) =>
        dependencies.app.fetch(request, {
            workflows: dependencies.workflows,
            readiness: (signal) => readiness(config, dependencies, signal),
        }),
});
