/**
 * JSON-line logging for the proof-of-concept processes. One line per record
 * with `time`, `level`, `msg`, and fields, matching the shape that
 * `apps/control-api/src/logger.ts` produces so the harness can parse both
 * processes' output the same way.
 */
export type LogLevel = "debug" | "info" | "warning" | "error";

export type LogFields = Record<string, unknown>;

export function log(level: LogLevel, msg: string, fields: LogFields = {}): void {
    console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }));
}
