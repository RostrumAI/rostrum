import { describe, expect, test } from "bun:test";
import { getLogger, type LogRecord } from "@logtape/logtape";
import { configureLogging, formatJsonLine } from "./logger";

function record(partial: Partial<LogRecord>): LogRecord {
    return {
        category: ["control-api"],
        level: "info",
        message: [],
        rawMessage: "",
        timestamp: 0,
        properties: {},
        ...partial,
    };
}

describe("logging", () => {
    test("formats one JSON line per record with time, level, msg, and fields", () => {
        const line = formatJsonLine(
            record({
                level: "info",
                rawMessage: "listening",
                timestamp: Date.UTC(2026, 0, 1),
                properties: { port: 3000 },
            }),
        );
        const entry = JSON.parse(line) as Record<string, unknown>;
        expect(entry).toEqual({
            time: "2026-01-01T00:00:00.000Z",
            level: "info",
            msg: "listening",
            port: 3000,
        });
    });

    test("configureLogging filters levels below the threshold", async () => {
        const records: LogRecord[] = [];
        await configureLogging("warning", (r) => records.push(r));
        const logger = getLogger("control-api");
        logger.debug("hidden");
        logger.info("hidden");
        logger.warn("shown");
        logger.error("also shown");
        expect(records.map((r) => r.level)).toEqual(["warning", "error"]);
    });

    test("configureLogging passes fields through to the sink", async () => {
        const records: LogRecord[] = [];
        await configureLogging("info", (r) => records.push(r));
        getLogger("control-api").warn("handler failed", {
            error: "boom",
            path: "/api/v1/system/health",
        });
        expect(records).toHaveLength(1);
        expect(records[0]?.properties).toEqual({ error: "boom", path: "/api/v1/system/health" });
    });
});
