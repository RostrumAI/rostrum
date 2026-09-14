/** @fileoverview Control API process entry point. */

import { type ControlApiConfig, ServiceConfigSource } from "@rostrum/server/config";
import { runService } from "@rostrum/server/lifecycle";
import { createResources, type Resources, readiness } from "./services";

/** Starts the Control API with reloadable configuration and owned resources. */
const config = new ServiceConfigSource("control-api");
await runService<ControlApiConfig, Resources>({
    name: "control-api",
    loadConfig: () => config.load(),
    createResources,
    fetch: (request, config, resources) =>
        resources.app.fetch(request, {
            workflows: resources.workflows,
            readiness: (signal) => readiness(config, resources, signal),
        }),
});
