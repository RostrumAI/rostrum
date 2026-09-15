/** @fileoverview The daemon's controller builder, fixed to its own context and tags. */

import { createControllerBuilder } from "@rostrum/server/controller";
import type { DaemonContext } from "../daemon";
import type { DaemonTag } from "./tags";

/**
 * Declares the daemon's controllers against the daemon's own context and tags.
 * Every controller module uses this one builder, so controllers see the daemon's
 * context fields and the generated contract accepts only the daemon's tags.
 */
export const defineDaemonController = createControllerBuilder<DaemonContext, DaemonTag>();
