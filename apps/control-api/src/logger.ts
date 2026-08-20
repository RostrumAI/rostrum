export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** Structured JSON-line logger selected by Decision e1-s0. */
export function createLogger(
  level: LogLevel,
  sink: (line: string) => void = (line) => console.log(line),
): Logger {
  const enabled = (candidate: LogLevel) => LEVEL_ORDER[candidate] >= LEVEL_ORDER[level];
  const emit = (candidate: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (!enabled(candidate)) return;
    sink(JSON.stringify({ time: new Date().toISOString(), level: candidate, msg, ...fields }));
  };
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
