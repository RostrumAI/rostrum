/** @fileoverview The daemon's complete route table, registered explicitly. */

import type { ServerApp } from "@rostrum/server/app";
import { createServiceRegistrar } from "@rostrum/server/app";
import type { DaemonContext } from "./daemon";
import { health } from "./services/system/health";
import { readiness } from "./services/system/readiness";

/**
 * Binds every daemon route. Registration is static: no filesystem scan, no
 * dynamic import, and no folder-derived path.
 */
export function registerRoutes(app: ServerApp<DaemonContext>): void {
    const register = createServiceRegistrar(app);

    register(health);
    register(readiness);
}
