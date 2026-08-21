/**
 * RFC 8785 (JSON Canonicalization Scheme) serialization.
 *
 * Member names sort lexicographically by UTF-16 code unit, numbers use
 * the shortest IEEE-754 round-trip form (`1.0` becomes `1`, `-0` becomes
 * `0`), strings use minimal escaping, and there is no whitespace.
 * `NaN` and `Infinity` have no canonical number form and are rejected.
 */

/** Raised when a value cannot be represented in canonical JSON form. */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

/** Serializes a number per RFC 8785 §3.2.2.4; non-finite values are rejected. */
function serializeNumber(value: number): string {
  if (!Number.isFinite(value))
    throw new CanonicalizationError("NaN and Infinity have no canonical JSON form");
  return String(value);
}

/** Serializes a parsed JSON value to its RFC 8785 canonical form. */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return serializeNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Default Array sort orders strings by UTF-16 code unit, which is the
    // member ordering RFC 8785 §3.2.2.3 requires.
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new CanonicalizationError(`Value of type '${typeof value}' is not valid JSON`);
}
