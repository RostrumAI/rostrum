/** @fileoverview Control API process entry point. */

import { type ControlApiConfig, ServiceConfigSource } from "@rostrum/server/config";
import { runService } from "@rostrum/server/lifecycle";
import { createResources, type Resources } from "./services";

/** Starts one Control API configuration with owned resources. */
await runService<ControlApiConfig, Resources>({
    name: "control-api",
    loadConfig: () => new ServiceConfigSource("control-api").load(),
    createResources,
    fetch: (request, _config, resources, abortSignal) => resources.fetch(request, abortSignal),
});
