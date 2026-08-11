import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys recursively sorted, no insignificant
 * whitespace. The digest rule is provisional until E1-S3 decides publication
 * identity; the POC rule is documented in the E1-S0 result record.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** SHA-256 of the canonical JSON. */
export function workflowDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
