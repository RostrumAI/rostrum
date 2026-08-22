import { describe, expect, test } from "bun:test";
import { CanonicalizationError, canonicalize } from "./canonical-json";

describe("canonicalize", () => {
    test("sorts member names by UTF-16 code unit", () => {
        expect(canonicalize({ "\u20ac": 1, A: 2, a: 3, "": 4 })).toBe(
            '{"":4,"A":2,"a":3,"\u20ac":1}',
        );
    });

    test("serializes numbers in shortest round-trip form", () => {
        expect(canonicalize(1.0)).toBe("1");
        expect(canonicalize(-0)).toBe("0");
        expect(canonicalize(1e21)).toBe("1e+21");
        expect(canonicalize(1e-7)).toBe("1e-7");
        expect(canonicalize(-2.5e-3)).toBe("-0.0025");
        expect(canonicalize([0.1 + 0.2])).toBe("[0.30000000000000004]");
    });

    test("escapes strings minimally", () => {
        expect(canonicalize('quote" backslash\\ newline\n tab\t control\u0001')).toBe(
            '"quote\\" backslash\\\\ newline\\n tab\\t control\\u0001"',
        );
    });

    test("emits no whitespace and sorts nested members", () => {
        expect(canonicalize({ b: [{ z: 1, y: 2 }], a: {} })).toBe('{"a":{},"b":[{"y":2,"z":1}]}');
    });
    test("preserves unicode without normalization", () => {
        const nfc = "\u00e9";
        const nfd = "e\u0301";
        expect(nfc).not.toBe(nfd);
        expect(canonicalize(nfc)).not.toBe(canonicalize(nfd));
    });

    test("rejects non-finite numbers", () => {
        expect(() => canonicalize(NaN)).toThrow(CanonicalizationError);
        expect(() => canonicalize(Infinity)).toThrow(CanonicalizationError);
        expect(() => canonicalize({ a: Number("1e999") })).toThrow(CanonicalizationError);
    });

    test("rejects values that are not JSON", () => {
        expect(() => canonicalize(undefined)).toThrow(CanonicalizationError);
        expect(() => canonicalize([undefined])).toThrow(CanonicalizationError);
        expect(() => canonicalize(1n)).toThrow(CanonicalizationError);
        expect(() => canonicalize(() => null)).toThrow(CanonicalizationError);
    });
});
