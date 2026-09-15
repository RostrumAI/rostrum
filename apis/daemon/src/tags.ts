/** @fileoverview The daemon's OpenAPI tag vocabulary. */

import type { ServiceTag } from "@rostrum/server/service";

/**
 * Tags group the daemon's operations in the generated contract. The compiler
 * setting `erasableSyntaxOnly` rejects a native enum, so the runtime values and
 * the derived union come from one `as const` record.
 */
export const DAEMON_TAG = {
    SYSTEM: "system",
} as const;

/** Every tag the daemon may declare on a service. */
export type DaemonTag = (typeof DAEMON_TAG)[keyof typeof DAEMON_TAG];

/** Narrows a tag list to the daemon's vocabulary. */
export type DaemonServiceTag = ServiceTag & DaemonTag;
