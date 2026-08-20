/**
 * RFC 8785 (JSON Canonicalization Scheme) canonicalizer, test-scoped.
 *
 * Implements the subset of RFC 8785 needed to reproduce the E1-S3 digest
 * vectors for the specification examples: UTF-16 code-unit member sorting,
 * ES2020 `Number::toString` number serialization, minimal string escaping,
 * and no whitespace. The E1-04 library ships the production
 * implementation; this copy exists so the committed vectors are reproduced
 * by two independent implementations before E1-05 publishes them, as the
 * E1-S3 decision requires.
 */

/** Sorts by UTF-16 code units, per RFC 8785 §3.2.2.3. */
function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  const aUnits = a.split("").map((c) => c.charCodeAt(0));
  const bUnits = b.split("").map((c) => c.charCodeAt(0));
  const length = Math.min(aUnits.length, bUnits.length);
  for (let i = 0; i < length; i++) {
    if (aUnits[i] !== bUnits[i]) return aUnits[i] < bUnits[i] ? -1 : 1;
  }
  return aUnits.length - bUnits.length;
}

/** Escapes a string per RFC 8785 §3.2.2.2: `"` and `\` plus control characters. */
function serializeString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === '"' || ch === "\\") {
      out += `\\${ch}`;
    } else if (code < 0x20) {
      const hex = code.toString(16).padStart(4, "0");
      out += `\\u${hex}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

/** Serializes a number per RFC 8785 §3.2.2.4 (ES `Number::toString`, rejects non-finite). */
export function serializeNumber(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error("NaN and Infinity are not valid JSON values");
  }
  if (Object.is(value, -0)) return "0";
  return String(value);
}

/** Serializes a parsed JSON value to its RFC 8785 canonical form. */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return serializeNumber(value);
  if (typeof value === "string") return serializeString(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort(compareKeys)
      .map((key) => `${serializeString(key)}:${canonicalize(record[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new Error(`Unsupported value: ${typeof value}`);
}

/**
 * Computes the published-version digest of a workflow document: SHA-256
 * (lowercase hex) over the RFC 8785 canonical form of the document with
 * the metadata members (`name`, `description` in v1) removed first.
 */
export async function digestWorkflow(document: Record<string, unknown>): Promise<string> {
  const { name: _name, description: _description, ...definitional } = document;
  const canonical = canonicalize(definitional);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
