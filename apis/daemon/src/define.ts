/** @fileoverview The daemon's service builder, fixed to its own context and tags. */

import { createServiceBuilder } from "@rostrum/server/service";
import type { DaemonContext } from "./daemon";
import type { DaemonTag } from "./tags";

/**
 * Declares the daemon's services against the daemon's own context and tags.
 * Every service module uses this one builder, so handlers see the daemon's
 * context fields and the generated contract accepts only the daemon's tags.
 */
export const defineDaemonService = createServiceBuilder<DaemonContext, DaemonTag>();
