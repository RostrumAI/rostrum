/** @fileoverview One-shot service configuration loading and validation. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ObjectOptions, type TObject, Type } from "typebox";
import { Value } from "typebox/value";
import { ConfigurationError } from "./network";

/** How one environment variable's text is coerced before validation. */
export type EnvironmentKind = "string" | "integer" | "boolean";

/** One environment variable a configuration field may come from. */
export interface EnvironmentBinding {
    /** The variable name. */
    readonly name: string;
    /** The value kind the variable's text must express. */
    readonly kind: EnvironmentKind;
}

/** Inputs a definition's finalizer needs beyond the validated settings. */
export interface ConfigFinalizeContext {
    /** The directory the selected configuration file was resolved against. */
    readonly root: string;
    /** The startup environment the settings were read from. */
    readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * One application's configuration definition: what can be configured, where
 * each value comes from, and how validated settings become a configuration.
 */
export interface ConfigDefinition<C> {
    /** Every setting, with unknown keys rejected. */
    readonly schema: TObject;
    /** The documented defaults, derived from the settings layered so far. */
    readonly defaults: (settings: Record<string, unknown>) => Record<string, unknown>;
    /** Environment variables, keyed by configuration field. */
    readonly environment: Record<string, EnvironmentBinding>;
    /** Environment variable naming the YAML file to read. */
    readonly fileSelector: string;
    /** The file read when the selector names nothing. */
    readonly defaultFile: string;
    /** Turns validated settings into the application's configuration. */
    readonly finalize: (settings: Record<string, unknown>, context: ConfigFinalizeContext) => C;
}

/**
 * Declares one application's configuration. The definition is checked once,
 * here, so a mistake in the definition fails at startup rather than at the
 * first load.
 */
export function defineConfig<C>(definition: ConfigDefinition<C>): ConfigDefinition<C> {
    if (ObjectOptions(definition.schema).additionalProperties !== false) {
        throw new ConfigurationError("config", "schema must reject unknown keys");
    }
    const fields = new Set(Object.keys(definition.schema.properties));
    const names = new Set<string>();
    for (const [field, binding] of Object.entries(definition.environment)) {
        // A binding for a field the schema does not declare is a definition mistake.
        if (!fields.has(field)) {
            throw new ConfigurationError("config", `environment binding "${field}" has no setting`);
        }
        if (binding.name.trim() === "") {
            throw new ConfigurationError("config", `environment binding "${field}" needs a name`);
        }
        if (names.has(binding.name)) {
            throw new ConfigurationError(
                "config",
                `environment variable ${binding.name} is used twice`,
            );
        }
        names.add(binding.name);
    }
    return definition;
}

/**
 * Loads and validates one complete configuration. The file is read once, the
 * environment overrides it per variable, documented defaults fill the rest,
 * and the definition's finalizer owns everything specific to the application.
 */
export function loadConfig<C>(
    root: string,
    definition: ConfigDefinition<C>,
    env: Record<string, string | undefined> = process.env,
): C {
    // Refuse to start with certificate verification disabled, wherever it was set.
    if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
        throw new ConfigurationError(
            "NODE_TLS_REJECT_UNAUTHORIZED",
            "must not disable certificate verification",
        );
    }

    // Fix the working directory and the selected file for this load.
    const directory = resolve(root);
    const selected = env[definition.fileSelector];
    if (selected !== undefined && selected.trim() === "") {
        throw new ConfigurationError("config", "must select a non-empty file path");
    }
    const file = resolve(directory, selected ?? definition.defaultFile);

    // Read the YAML file; only the default file may be absent.
    let text: string | undefined;
    try {
        text = readFileSync(file, "utf8");
    } catch (error) {
        if (selected !== undefined || (error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw new ConfigurationError("config", "must be a readable YAML file");
        }
    }

    // The file must parse as YAML.
    let fromFile: unknown = {};
    if (text !== undefined) {
        try {
            fromFile = Bun.YAML.parse(text) ?? {};
        } catch {
            throw new ConfigurationError("config", "must contain valid YAML");
        }
    }

    // Unknown keys and wrongly typed fields are operator mistakes, not settings.
    if (!Value.Check(Type.Partial(definition.schema), fromFile)) {
        throw new ConfigurationError("config", "contains unknown keys or invalid field types");
    }

    // Environment variables win over the file, coerced by their declared kind.
    const layered = { ...(fromFile as Record<string, unknown>) };
    for (const [field, binding] of Object.entries(definition.environment)) {
        const value = env[binding.name];
        if (value === undefined) {
            continue;
        }
        if (binding.kind === "integer") {
            if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value))) {
                throw new ConfigurationError(field, "must be an integer");
            }
            layered[field] = Number(value);
        } else if (binding.kind === "boolean") {
            if (value !== "true" && value !== "false") {
                throw new ConfigurationError(field, "must be true or false");
            }
            layered[field] = value === "true";
        } else {
            layered[field] = value;
        }
    }

    // Documented defaults fill whatever the file and environment left unset; the
    // definition reads the layered values, so a default may depend on another setting.
    const candidate: Record<string, unknown> = { ...definition.defaults(layered), ...layered };

    // Reject an incomplete or invalid candidate, naming the property at fault.
    if (!Value.Check(definition.schema, candidate)) {
        // Schema messages may include supplied values: report only the known property name.
        for (const [field, property] of Object.entries(definition.schema.properties)) {
            if (candidate[field] === undefined) {
                continue;
            }
            if (!Value.Check(property, candidate[field])) {
                throw new ConfigurationError(field, "is missing or invalid");
            }
        }
        throw new ConfigurationError("config", "contains invalid settings");
    }

    // The application owns what its settings mean; the loader owns the read.
    return Object.freeze(definition.finalize(candidate, { root: directory, env }));
}
