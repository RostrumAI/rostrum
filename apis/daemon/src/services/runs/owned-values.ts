/** @fileoverview Owned, immutable copies of JSON values held by prepared workflows and runs. */

/**
 * Takes an owned, deep-frozen copy of a JSON value, so nothing outside
 * the holder can change it later. Author-chosen member names such as
 * `__proto__` stay ordinary own members.
 */
export function ownedCopy<T>(value: T): T {
    return deepFreeze(structuredClone(value));
}

/**
 * Freezes a value and everything inside it. The walk uses an explicit
 * stack rather than recursion, so a deeply nested value that parsing and
 * cloning accepted can't overflow the call stack here.
 */
export function deepFreeze<T>(value: T): T {
    const pending: unknown[] = [value];
    while (pending.length > 0) {
        const current = pending.pop();
        if (typeof current === "object" && current !== null && !Object.isFrozen(current)) {
            Object.freeze(current);
            // One push per member: spreading a very wide value could pass the engine's argument limit.
            for (const child of Object.values(current)) {
                pending.push(child);
            }
        }
    }
    return value;
}
