/** @fileoverview Daemon process entry point. */

import { type DaemonConfig, ServiceConfigSource } from "@rostrum/server/config";
import { runService } from "@rostrum/server/lifecycle";
import { authenticate } from "./auth";
import { createResources, type Resources } from "./services";

/** Starts the daemon with authenticated admission and reloadable configuration. */
const config = new ServiceConfigSource("daemon");
await runService<DaemonConfig, Resources>({
    name: "daemon",
    loadConfig: () => config.load(),
    createResources,
    authenticate,
    fetch: (request, config, resources, signal) =>
        resources.app.fetch(request, {
            database: resources.database,
            config,
            abortSignal: signal,
        }),
});
