/** @fileoverview Daemon process entry point. */

import { type DaemonConfig, ServiceConfigSource } from "@rostrum/server/config";
import { runService } from "@rostrum/server/lifecycle";
import { authenticate } from "./auth";
import { createResources, type Resources } from "./services";

/** Starts one daemon configuration with authenticated admission and owned resources. */
await runService<DaemonConfig, Resources>({
    name: "daemon",
    loadConfig: () => new ServiceConfigSource("daemon").load(),
    createResources,
    authenticate,
    fetch: (request, _config, resources, abortSignal) => resources.fetch(request, abortSignal),
});
