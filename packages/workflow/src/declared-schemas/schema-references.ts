import { isJsonSchema, type JsonSchema } from "./declared-schema-compiler";
import { IGNORED_KEYWORDS, isObject } from "./schema-keywords";

/**
 * Resolves local JSON Pointer references (`#`, `#/$defs/name`) inside one
 * schema document, and refuses references that are external or that
 * lead back to themselves. The containment check inlines what this
 * resolves and reads anything it refuses as unprovable or wider.
 */
export class ReferenceResolver {
    private readonly root: JsonSchema;
    private readonly recursive = new Map<string, boolean>();

    /** Binds the resolver to the document references point into. */
    constructor(root: JsonSchema) {
        this.root = root;
    }

    /**
     * Returns the schema a local, non-recursive reference points to, or
     * undefined for an external, dangling, or recursive reference.
     */
    resolve(reference: string): JsonSchema | undefined {
        const target = this.lookup(reference);
        if (target === undefined || this.isRecursive(reference)) {
            return undefined;
        }
        return target;
    }

    /** Follows a `#`-prefixed JSON Pointer from the root. */
    private lookup(reference: string): JsonSchema | undefined {
        if (!reference.startsWith("#")) {
            return undefined;
        }
        let current: unknown = this.root;
        const pointer = reference.slice(1);
        if (pointer !== "" && !pointer.startsWith("/")) {
            return undefined;
        }
        for (const token of pointer === "" ? [] : pointer.slice(1).split("/")) {
            const key = decodeURIComponent(token).replaceAll("~1", "/").replaceAll("~0", "~");
            if (Array.isArray(current)) {
                current = Object.hasOwn(current, key) ? current[Number(key)] : undefined;
            } else if (isObject(current) && Object.hasOwn(current, key)) {
                current = current[key];
            } else {
                return undefined;
            }
        }
        return isJsonSchema(current) ? current : undefined;
    }

    /** True when the reference's target can reach the same reference again. */
    private isRecursive(reference: string): boolean {
        const known = this.recursive.get(reference);
        if (known !== undefined) {
            return known;
        }
        const target = this.lookup(reference);
        const recursive = target !== undefined && this.reaches(target, reference, new Set());
        this.recursive.set(reference, recursive);
        return recursive;
    }

    /** Walks a schema, following references, looking for the given reference. */
    private reaches(schema: unknown, reference: string, followed: Set<string>): boolean {
        if (Array.isArray(schema)) {
            return schema.some((member) => this.reaches(member, reference, followed));
        }
        if (!isObject(schema)) {
            return false;
        }
        for (const [keyword, value] of Object.entries(schema)) {
            if (keyword === "$ref" && typeof value === "string") {
                if (value === reference) {
                    return true;
                }
                if (!followed.has(value)) {
                    followed.add(value);
                    if (this.reaches(this.lookup(value), reference, followed)) {
                        return true;
                    }
                }
                continue;
            }
            // Literal values and unused definitions can't apply a reference.
            if (
                keyword === "const" ||
                keyword === "enum" ||
                keyword === "$defs" ||
                IGNORED_KEYWORDS.has(keyword)
            ) {
                continue;
            }
            if (this.reaches(value, reference, followed)) {
                return true;
            }
        }
        return false;
    }
}
