/** @fileoverview Daemon process entry point. */

import { type DaemonConfig, ServiceConfigSource } from "@rostrum/server/config";
import { runService } from "@rostrum/server/lifecycle";
import { authenticate } from "./auth";
import { createDependencies, type Dependencies } from "./services";

/** Starts the daemon with authenticated admission and reloadable configuration. */
const config = new ServiceConfigSource("daemon");
await runService<DaemonConfig, Dependencies>({
    name: "daemon",
    loadConfig: () => config.load(),
    createDependencies,
    authenticate,
    fetch: (request, config, dependencies, signal) =>
        dependencies.app.fetch(request, {
            database: dependencies.database,
            config,
            signal,
        }),
});
