/** @fileoverview The Control API's OpenAPI tag vocabulary. */

/**
 * Tags group the Control API's operations in the generated contract. The
 * compiler setting `erasableSyntaxOnly` rejects a native enum, so the runtime
 * values and the derived union come from one `as const` record.
 */
export const CONTROL_API_TAG = {
    SYSTEM: "system",
    WORKFLOWS: "workflows",
} as const;

/** Every tag the Control API may declare on a controller. */
export type ControlApiTag = (typeof CONTROL_API_TAG)[keyof typeof CONTROL_API_TAG];
