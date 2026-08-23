import { describe, expect, test } from "bun:test";
import { isUuidV7, mintUuidV7 } from "../src/uuid-v7";

describe("mintUuidV7", () => {
    test("mints syntactically valid UUID v7 values", () => {
        const id = mintUuidV7();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(isUuidV7(id)).toBe(true);
    });

    test("encodes the given timestamp in the first 48 bits", () => {
        const timestamp = 1_755_000_000_000; // 2025-08-15T12:00:00Z, ms precision
        const id = mintUuidV7(() => timestamp);
        const decoded = BigInt(`0x${id.replaceAll("-", "").slice(0, 12)}`);
        expect(decoded).toBe(BigInt(timestamp));
    });

    test("later timestamps order lexicographically after earlier ones", () => {
        let clock = 1_755_000_000_000;
        const ids = Array.from({ length: 32 }, () => mintUuidV7(() => clock++));
        const sorted = [...ids].sort();
        expect(sorted).toEqual(ids);
    });

    test("clamps negative clock readings to zero", () => {
        const id = mintUuidV7(() => -5);
        expect(isUuidV7(id)).toBe(true);
        expect(id.startsWith("00000000-")).toBe(true);
    });

    test("isUuidV7 rejects other versions and malformed shapes", () => {
        expect(isUuidV7("not-a-uuid")).toBe(false);
        expect(isUuidV7("0192b0a0-7e1d-4000-8000-000000000001")).toBe(false); // v4 nibble
        expect(isUuidV7("0192B0A0-7E1D-7000-8000-000000000001")).toBe(true); // case-insensitive
    });
});
