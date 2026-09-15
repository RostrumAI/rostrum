/** @fileoverview Named schemas: the component name a schema is documented under. */

import type { TSchema } from "typebox";

/**
 * A schema paired with the component name it is documented under. An OpenAPI
 * document references a shared shape by name, and a TypeBox schema carries no
 * name of its own, so a schema a service wants referenced arrives with one.
 */
export interface DefinedSchema<Schema extends TSchema = TSchema> {
    /** The component name this schema is contributed under. */
    readonly name: string;
    /** The schema itself. */
    readonly schema: Schema;
}

/**
 * Names a schema so any service may reference it as a documented component.
 * The same name and the same schema may be referenced from several services;
 * the registrar contributes one component.
 */
export function defineSchema<const Name extends string, Schema extends TSchema>(
    name: Name,
    schema: Schema,
): DefinedSchema<Schema> & { readonly name: Name } {
    return { name, schema };
}

/** Reports whether a value is a schema that carries its component name. */
export function isDefinedSchema(value: unknown): value is DefinedSchema {
    return (
        typeof value === "object" &&
        value !== null &&
        "name" in value &&
        "schema" in value &&
        typeof (value as { name: unknown }).name === "string"
    );
}

/**
 * Returns the schema a declared reference stands for, whether the service
 * named it as a component or declared it inline for this operation alone.
 */
export function schemaOf(reference: TSchema | DefinedSchema): TSchema {
    return isDefinedSchema(reference) ? reference.schema : reference;
}
