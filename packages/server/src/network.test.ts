/** @fileoverview Loopback and daemon URL validation tests. */

import { describe, expect, test } from "bun:test";
import { ConfigurationError, isLiteralLoopback, validateDaemonUrl } from "./network";

describe("literal loopback transport", () => {
    test("accepts parsed loopback IPs without treating mapped IPv6 as local", () => {
        for (const host of ["127.0.0.1", "127.255.255.254", "::1", "0:0:0:0:0:0:0:1"]) {
            expect(isLiteralLoopback(host)).toBe(true);
        }
        for (const host of [
            "localhost",
            "127.1",
            "2130706433",
            "0x7f000001",
            "127.00.0.1",
            "127.0.0.1.example",
            "::ffff:127.0.0.1",
            "::ffff:7f00:1",
            "::1%lo0",
            "[::1]",
            "0.0.0.0",
            "192.168.1.1",
        ]) {
            expect(isLiteralLoopback(host)).toBe(false);
        }
    });

    test("checks raw literal authority even for HTTPS local exceptions", () => {
        for (const host of [
            "localhost",
            "127.1",
            "2130706433",
            "0x7f000001",
            "127.00.0.1",
            "127.0.0.1.",
            "%31%32%37.0.0.1",
            "[::ffff:127.0.0.1]",
            "daemon.example",
        ]) {
            for (const scheme of ["http", "https"]) {
                expect(() => validateDaemonUrl(`${scheme}://${host}`, true)).toThrow(
                    ConfigurationError,
                );
            }
        }
        expect(validateDaemonUrl("https://[0:0:0:0:0:0:0:1]:443/", true)).toBe("https://[::1]");
        expect(validateDaemonUrl("http://127.3.2.1:3001/", true)).toBe("http://127.3.2.1:3001");
        expect(validateDaemonUrl("https://daemon.example:8443/", false)).toBe(
            "https://daemon.example:8443",
        );
        expect(() => validateDaemonUrl("http://127.0.0.1", false)).toThrow(ConfigurationError);
    });

    test("rejects origins whose syntax URL parsing would normalize away", () => {
        for (const value of [
            "https://user:password@127.0.0.1",
            "https://@127.0.0.1",
            "https://127.0.0.1?",
            "https://127.0.0.1#",
            "https://127.0.0.1/../",
            "https://127.0.0.1/a/..",
            "https://127.0.0.1/\\",
            " https://127.0.0.1",
            "https://127.0.0.1\n",
            "https://127.0.\t0.1",
            "https://127.0.0.1:",
            "https://127.0.0.1:65536",
        ]) {
            expect(() => validateDaemonUrl(value, true)).toThrow(ConfigurationError);
        }
    });
});
