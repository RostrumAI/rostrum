import canonicalJson from "canonicalize";

/**
 * RFC 8785 (JSON Canonicalization Scheme) serialization.
 *
 * Serialization is delegated to the `canonicalize` package, the
 * JavaScript implementation listed in RFC 8785 Appendix G. This module
 * keeps the workflow-specific contract on top of it: values outside
 * JSON — `undefined`, `bigint`, functions, symbols — are rejected
 * instead of coerced the way the library and `JSON.stringify` would,
 * and every rejection is raised as a `CanonicalizationError`.
 */

/** Raised when a value cannot be represented in canonical JSON form. */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

/**
 * Rejects values that are not valid JSON before the library sees them.
 * The library follows `JSON.stringify` conventions for `undefined`
 * (dropped from objects, nulled in arrays), which would silently change
 * content that this contract requires rejecting.
 */
function assertJsonValue(value: unknown): void {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonValue(item);
    }
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      assertJsonValue(item);
    }
    return;
  }
  throw new CanonicalizationError(`Value of type '${typeof value}' is not valid JSON`);
}

/** Serializes a parsed JSON value to its RFC 8785 canonical form. */
export function canonicalize(value: unknown): string {
  assertJsonValue(value);
  try {
    // The validity pre-check guarantees a string result; the library's
    // return type includes undefined only for `undefined` input.
    const canonical = canonicalJson(value);
    if (canonical === undefined) {
      throw new CanonicalizationError("The value has no canonical JSON form");
    }
    return canonical;
  } catch (error) {
    if (error instanceof CanonicalizationError) {
      throw error;
    }
    // The library rejects non-finite numbers, which have no canonical form.
    throw new CanonicalizationError(error instanceof Error ? error.message : String(error));
  }
}
