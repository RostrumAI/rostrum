/** @fileoverview Shared health, readiness, and boundary error schemas. */

import { type Static, Type } from "typebox";

// Liveness: the simplest response every service shares.
/** Wire shape of the liveness response. */
export const HealthSchema = Type.Object(
    { status: Type.Literal("ok") },
    { additionalProperties: false },
);
/** The liveness response a service returns while it is up. */
export type Health = Static<typeof HealthSchema>;

// Boundary failures: one body for every service that answers at the edge.
/** Wire shape of the boundary failure body every service returns. */
export const BoundaryErrorSchema = Type.Object(
    {
        code: Type.String({ minLength: 1 }),
        message: Type.String(),
        // Boundary failures carry no findings; the empty object item keeps the
        // schema serializable by the OpenAPI generator while maxItems pins it empty.
        findings: Type.Array(Type.Object({}, { additionalProperties: false }), { maxItems: 0 }),
    },
    { additionalProperties: false },
);
/** The boundary failure body carrying a stable code and a caller-readable message. */
export type BoundaryError = Static<typeof BoundaryErrorSchema>;

// Readiness checks: each dependency answers ok or a failure carrying a stable code.
const OkSchema = Type.Object({ status: Type.Literal("ok") }, { additionalProperties: false });
const DatabaseFailureSchema = Type.Object(
    {
        status: Type.Literal("failed"),
        code: Type.Union([
            Type.Literal("database_unavailable"),
            Type.Literal("database_timeout"),
            Type.Literal("database_schema_unavailable"),
        ]),
    },
    { additionalProperties: false },
);
const DaemonFailureSchema = Type.Object(
    {
        status: Type.Literal("failed"),
        code: Type.Union([
            Type.Literal("daemon_unavailable"),
            Type.Literal("daemon_timeout"),
            Type.Literal("daemon_unauthorized"),
            Type.Literal("daemon_tls_error"),
            Type.Literal("daemon_invalid_response"),
            Type.Literal("daemon_not_ready"),
        ]),
    },
    { additionalProperties: false },
);
const DatabaseCheckSchema = Type.Union([OkSchema, DatabaseFailureSchema]);
const DaemonCheckSchema = Type.Union([OkSchema, DaemonFailureSchema]);

/** One dependency's readiness outcome: ok, or a failure with its stable code. */
export type CheckResult =
    | Static<typeof OkSchema>
    | Static<typeof DatabaseFailureSchema>
    | Static<typeof DaemonFailureSchema>;

// The aggregate a readiness caller receives.
/** Overall readiness with one result per dependency that was checked. */
export interface Readiness {
    status: "ready" | "not_ready";
    checks: { database?: CheckResult; daemon?: CheckResult };
}

// The daemon's readiness document: its database is the only dependency.
/** Wire shape of the daemon's readiness document. */
export const DaemonReadinessSchema = Type.Union([
    Type.Object(
        {
            status: Type.Literal("ready"),
            checks: Type.Object({ database: OkSchema }, { additionalProperties: false }),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: Type.Literal("not_ready"),
            checks: Type.Object(
                { database: DatabaseFailureSchema },
                { additionalProperties: false },
            ),
        },
        { additionalProperties: false },
    ),
]);
/** The daemon's readiness document. */
export type DaemonReadiness = Static<typeof DaemonReadinessSchema>;

// The Control API's readiness document: the failing dependency is present, its
// healthy sibling optional.
/** Wire shape of the Control API's readiness document. */
export const ControlApiReadinessSchema = Type.Union([
    Type.Object(
        {
            status: Type.Literal("ready"),
            checks: Type.Object(
                { database: OkSchema, daemon: OkSchema },
                { additionalProperties: false },
            ),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: Type.Literal("not_ready"),
            checks: Type.Union([
                Type.Object(
                    { database: DatabaseFailureSchema, daemon: Type.Optional(DaemonCheckSchema) },
                    { additionalProperties: false },
                ),
                Type.Object(
                    { database: Type.Optional(DatabaseCheckSchema), daemon: DaemonFailureSchema },
                    { additionalProperties: false },
                ),
            ]),
        },
        { additionalProperties: false },
    ),
]);
/** The Control API's readiness document. */
export type ControlApiReadiness = Static<typeof ControlApiReadinessSchema>;
