/** @fileoverview Shared health, readiness, and boundary error schemas. */

import { type Static, Type } from "typebox";

export const HealthSchema = Type.Object(
    { status: Type.Literal("ok") },
    { additionalProperties: false },
);
export type Health = Static<typeof HealthSchema>;

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
export type BoundaryError = Static<typeof BoundaryErrorSchema>;

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

export type CheckResult =
    | Static<typeof OkSchema>
    | Static<typeof DatabaseFailureSchema>
    | Static<typeof DaemonFailureSchema>;
export interface Readiness {
    status: "ready" | "not_ready";
    checks: { database?: CheckResult; daemon?: CheckResult };
}

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
export type DaemonReadiness = Static<typeof DaemonReadinessSchema>;

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
export type ControlApiReadiness = Static<typeof ControlApiReadinessSchema>;
