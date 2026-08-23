/**
 * Server-side UUID v7 minting.
 *
 * E1-S3 assigns identity minting to the server: the workflow `id` and every
 * revision `id` are UUID v7 values carrying a 48-bit Unix millisecond
 * timestamp (RFC 9562), so rows sort chronologically without a per-workflow
 * counter and rewinding never renumbers anything.
 */

/** Matches a syntactically valid UUID v7 string (case-insensitive). */
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Checks whether `value` is a syntactically valid UUID v7 string. */
export function isUuidV7(value: string): boolean {
    return UUID_V7_PATTERN.test(value);
}

/**
 * Mints one UUID v7 string. The 48-bit timestamp comes from `now`, which
 * defaults to `Date.now`; tests inject a clock to assert ordering
 * deterministically. The remaining bits are cryptographically random.
 */
export function mintUuidV7(now: () => number = Date.now): string {
    const bytes = new Uint8Array(16);
    const timestamp = BigInt(Math.max(0, Math.trunc(now())));
    for (let shift = 40; shift >= 0; shift -= 8) {
        const index = (40 - shift) / 8;
        const byteValue = Number((timestamp >> BigInt(shift)) & 0xffn);
        if (index >= 0 && index < 6) {
            bytes[index] = byteValue;
        }
    }
    crypto.getRandomValues(bytes.subarray(6));
    // Version 7 occupies the high nibble of byte 6; the RFC 9562 variant
    // `10xx` occupies the two high bits of byte 8.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    return formatUuid(bytes);
}

function formatUuid(bytes: Uint8Array): string {
    let hex = "";
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
