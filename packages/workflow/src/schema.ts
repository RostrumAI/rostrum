import { type Static, Type } from "typebox";

/**
 * Workflow interface v1 document schema.
 *
 * Source of truth for the public JSON Schema 2020-12 artifact in
 * docs/specs/workflow-interface-v1.schema.json. The shape follows E1-S1.
 * The schema expresses exactly the stage 2 (document shape) contract from
 * E1-S2: required fields, types, UUID v7 string formats, array bounds,
 * `maxIterations >= 1`, and `additionalProperties: false`.
 *
 * Rules that later validation stages own are intentionally absent from this
 * schema so their findings carry the right stage codes: mutual exclusions
 * and unknown step types (stage 3), predicate operators and conditional ref
 * shape (stage 5), data-reference syntax and resolution (stage 7). A
 * binding value is therefore any JSON value; the `{ "ref": "..." }`
 * interpretation is a stage 7 rule, not a shape rule.
 */

/**
 * The workflow interface version this package publishes.
 */
export const workflowInterfaceVersionSchema = Type.Literal("v1");

export type WorkflowInterfaceVersion = Static<typeof workflowInterfaceVersionSchema>;

/**
 * UUID v7: version nibble 7 in the third group, RFC 9562 variant (8, 9,
 * a, or b) in the fourth group, lowercase hexadecimal.
 */
const UUID_V7_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

const UuidV7 = Type.String({ pattern: UUID_V7_PATTERN });

/** Any JSON value. Used for binding values and JSON Schema fragments. */
const JsonValue = Type.Any({ title: "JSON value" });

/** A reference object: `{ "ref": "<path>" }`. Path syntax is checked in stage 7. */
const ReferenceObject = Type.Object({ ref: Type.String() }, { additionalProperties: false });

/** Bounded forEach loop configuration on a step. */
const Loop = Type.Object(
    {
        collection: ReferenceObject,
        maxIterations: Type.Integer({ minimum: 1 }),
        variable: Type.String(),
        body: UuidV7,
    },
    { additionalProperties: false },
);

/** A workflow step. `config` is validated against the step type's registered schema. */
const Step = Type.Object(
    {
        id: UuidV7,
        type: Type.String(),
        config: Type.Optional(Type.Object({}, { additionalProperties: true })),
        inputs: Type.Optional(Type.Record(Type.String(), JsonValue)),
        outputs: Type.Optional(Type.Record(Type.String(), JsonValue)),
        successors: Type.Optional(Type.Array(UuidV7)),
        dependencies: Type.Optional(Type.Array(UuidV7)),
        conditional: Type.Optional(UuidV7),
        loop: Type.Optional(Loop),
    },
    { additionalProperties: false },
);

/**
 * A condition expression: a leaf predicate (`ref`, `op`, optional `value`)
 * or an `all`/`any` group of nested conditions. The operator set and ref
 * path shape are checked in stage 5.
 */
const Condition = Type.Cyclic(
    {
        Condition: Type.Union([
            Type.Object(
                {
                    ref: Type.String(),
                    op: Type.String(),
                    value: Type.Optional(JsonValue),
                },
                { additionalProperties: false },
            ),
            Type.Object(
                { all: Type.Array(Type.Ref("Condition")) },
                { additionalProperties: false },
            ),
            Type.Object(
                { any: Type.Array(Type.Ref("Condition")) },
                { additionalProperties: false },
            ),
        ]),
    },
    "Condition",
);

/** A conditional branch rule. `next` omitted ends the workflow on this branch. */
const Branch = Type.Object(
    {
        label: Type.String(),
        priority: Type.Integer({ minimum: 0 }),
        condition: Condition,
        next: Type.Optional(UuidV7),
    },
    { additionalProperties: false },
);

/** The fallback branch taken when no branch condition matches. */
const DefaultBranch = Type.Object(
    {
        label: Type.String(),
        next: Type.Optional(UuidV7),
    },
    { additionalProperties: false },
);

/** A conditional: evaluated routing for a step that references it by id. */
const Conditional = Type.Object(
    {
        id: UuidV7,
        dependencies: Type.Array(UuidV7),
        branches: Type.Array(Branch, { minItems: 1 }),
        default: DefaultBranch,
    },
    { additionalProperties: false },
);

/** A workflow interface v1 document. */
export const WorkflowDocument = Type.Object(
    {
        interfaceVersion: workflowInterfaceVersionSchema,
        id: UuidV7,
        name: Type.String(),
        description: Type.Optional(Type.String()),
        firstNode: UuidV7,
        inputs: Type.Optional(Type.Record(Type.String(), JsonValue)),
        steps: Type.Array(Step, { minItems: 1 }),
        conditionals: Type.Optional(Type.Array(Conditional, { minItems: 1 })),
    },
    { additionalProperties: false },
);

export type WorkflowDocument = Static<typeof WorkflowDocument>;
