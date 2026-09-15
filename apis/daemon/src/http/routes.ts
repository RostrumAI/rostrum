/** @fileoverview The daemon's complete route table, registered explicitly. */

import type { ServerApp } from "@rostrum/server/app";
import { createControllerRegistrar } from "@rostrum/server/app";
import { health } from "../controllers/system/health";
import { readiness } from "../controllers/system/readiness";
import type { DaemonContext } from "../daemon";

/**
 * Binds every daemon route. Registration is static: no filesystem scan, no
 * dynamic import, and no folder-derived path.
 */
export function registerRoutes(app: ServerApp<DaemonContext>): void {
    const register = createControllerRegistrar(app);

    register(health);
    register(readiness);
}
