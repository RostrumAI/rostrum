/** @fileoverview The workflow domain schema both the transport and the service tier describe. */

import { defineSchema } from "@rostrum/server/schema";
import { Type } from "typebox";

/**
 * A single validation finding, mirroring the shared workflow library's
 * `Finding` exactly: stable code, human-readable message, blocking flag,
 * JSON Pointer, and the optional location, cross-reference, and structured
 * detail members the library attaches when source text is available.
 */
export const FindingSchema = Type.Object(
    {
        code: Type.String(),
        message: Type.String(),
        blocking: Type.Boolean(),
        path: Type.String(),
        line: Type.Optional(Type.Integer({ description: "One-based line in the saved text." })),
        column: Type.Optional(Type.Integer({ description: "One-based column in the saved text." })),
        relatedLocations: Type.Optional(
            Type.Array(
                Type.Object(
                    {
                        path: Type.String(),
                        message: Type.String(),
                    },
                    { additionalProperties: false },
                ),
            ),
        ),
        details: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
                description:
                    "Structured context an automated author can repair without parsing the message.",
            }),
        ),
    },
    { additionalProperties: false },
);

/**
 * The `Finding` component. No operation body references it: findings travel
 * inside the response bodies that carry them, and this value declares the
 * shape at application level so a client generated from the document still
 * has the `Finding` type by name.
 */
export const Finding = defineSchema("Finding", FindingSchema);
