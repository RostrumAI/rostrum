import { escapePointerToken } from "@rostrum/workflow";
import type { JsonObject, JsonValue } from "@rostrum/workflow/execution";

/**
 * JSON value handling for execution.
 *
 * Every value a caller supplies, a document declares, or a task produces is
 * checked here before the daemon reads, copies, or stores it. The check
 * rejects values that JSON cannot represent — `undefined`, functions,
 * symbols, non-finite numbers, exotic objects whose prototype is not
 * `Object.prototype`, accessor properties, sparse array holes, and reference
 * cycles — so no later step can silently drop or reinterpret data.
 */

/**
 * The deepest container nesting this release executes: 128 levels, counting
 * the root object or array as level one.
 *
 * The same bound applies to runtime values and to author schema fragments.
 * A deployment may configure a smaller bound; raising this ceiling needs
 * stack-safety evidence for the validator and the task handler, not just a
 * configuration change.
 */
export const MAX_VALUE_DEPTH = 128;

/** Why a value could not be accepted as JSON. */
export type JsonValueFailureCode = "invalid_json" | "value_depth";

/** The outcome of checking one value: the accepted value, or the location that failed. */
export type JsonValueCheckResult =
    | { readonly ok: true; readonly value: JsonValue }
    | { readonly ok: false; readonly code: JsonValueFailureCode; readonly path: string };

/**
 * Checks that a value is JSON, within `maxValueDepth` container levels.
 *
 * The walk reads own property descriptors, so it never invokes a getter or
 * `toJSON`, and it rejects a value that references itself. Recursion is
 * bounded because the depth limit is tested before descending.
 */
export function checkJsonValue(value: unknown, maxValueDepth: number): JsonValueCheckResult {
    return visit(value, "", 1, maxValueDepth, new Set<object>());
}

/**
 * Copies a checked value into a frozen structure the daemon owns.
 *
 * Caller-supplied input is copied so a caller cannot mutate data a run
 * already accepted. The copy keeps own member names, including
 * prototype-sensitive names such as `__proto__`, by building on a
 * prototype-less object.
 */
export function copyJsonValue(value: JsonValue): JsonValue {
    if (Array.isArray(value)) {
        return Object.freeze(value.map((element) => copyJsonValue(element)));
    }
    if (value !== null && typeof value === "object") {
        const copy: Record<string, JsonValue> = Object.create(null);
        for (const [key, member] of Object.entries(value)) {
            copy[key] = copyJsonValue(member);
        }
        return Object.freeze(copy);
    }
    return value;
}

/**
 * Freezes a checked value the daemon already owns, such as freshly parsed
 * publication content, without copying it.
 *
 * The caller hands over the value: freezing mutates it in place, and every
 * nested container becomes immutable.
 */
export function freezeJsonValue(value: JsonValue): JsonValue {
    if (Array.isArray(value)) {
        for (const element of value) {
            freezeJsonValue(element);
        }
        return Object.freeze(value);
    }
    if (value !== null && typeof value === "object") {
        for (const member of Object.values(value)) {
            freezeJsonValue(member);
        }
        return Object.freeze(value);
    }
    return value;
}

/**
 * Checks one value at its position, following containers depth-first.
 *
 * `ancestors` holds the containers on the current path, which distinguishes
 * a reference cycle from the same object appearing twice in sibling
 * positions — the second is duplicated data, not a cycle.
 */
function visit(
    value: unknown,
    path: string,
    depth: number,
    maxValueDepth: number,
    ancestors: Set<object>,
): JsonValueCheckResult {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return { ok: true, value };
    }
    if (typeof value === "number") {
        return Number.isFinite(value)
            ? { ok: true, value }
            : { ok: false, code: "invalid_json", path };
    }
    if (!isJsonContainer(value)) {
        return { ok: false, code: "invalid_json", path };
    }
    if (depth > maxValueDepth) {
        return { ok: false, code: "value_depth", path };
    }
    if (ancestors.has(value)) {
        return { ok: false, code: "invalid_json", path };
    }

    ancestors.add(value);
    const result = Array.isArray(value)
        ? visitArray(value, path, depth, maxValueDepth, ancestors)
        : visitObject(value, path, depth, maxValueDepth, ancestors);
    ancestors.delete(value);
    return result;
}

/** Checks each array element in index order, rejecting holes. */
function visitArray(
    value: readonly unknown[],
    path: string,
    depth: number,
    maxValueDepth: number,
    ancestors: Set<object>,
): JsonValueCheckResult {
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        // A hole has no element to encode; JSON would turn it into null.
        if (!descriptor || !("value" in descriptor)) {
            return { ok: false, code: "invalid_json", path: `${path}/${index}` };
        }
        const result = visit(
            descriptor.value,
            `${path}/${index}`,
            depth + 1,
            maxValueDepth,
            ancestors,
        );
        if (!result.ok) {
            return result;
        }
    }
    return { ok: true, value: value as JsonValue };
}

/** Checks each own enumerable string-keyed member in key order. */
function visitObject(
    value: object,
    path: string,
    depth: number,
    maxValueDepth: number,
    ancestors: Set<object>,
): JsonValueCheckResult {
    for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        // A plain object obtained from JSON never carries an accessor; a
        // handler-built one might, and reading it would run arbitrary code.
        if (!descriptor || !("value" in descriptor)) {
            return { ok: false, code: "invalid_json", path: `${path}/${escapePointerToken(key)}` };
        }
        const result = visit(
            descriptor.value,
            `${path}/${escapePointerToken(key)}`,
            depth + 1,
            maxValueDepth,
            ancestors,
        );
        if (!result.ok) {
            return result;
        }
    }
    return { ok: true, value: value as JsonObject };
}

/** True for the two containers JSON encodes: arrays and plain objects. */
function isJsonContainer(value: unknown): value is object {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    if (Array.isArray(value)) {
        return true;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
