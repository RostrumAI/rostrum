import { configure, type LogLevel, type LogRecord } from "@logtape/logtape";

/**
 * Formats one log record as a single JSON line: `time`, `level`, `msg`, and
 * the record's fields. Keeps process logs machine-readable for tests and log
 * collectors.
 */
export function formatJsonLine(record: LogRecord): string {
  return JSON.stringify({
    time: new Date(record.timestamp).toISOString(),
    level: record.level,
    msg: record.rawMessage,
    ...record.properties,
  });
}

/** Writes each formatted record to the console without blocking the caller. */
export function consoleSink(record: LogRecord): void {
  console.log(formatJsonLine(record));
}

/**
 * Configures LogTape for the process: the `control-api` logger writes JSON
 * lines through `sink`, filtered at `level`. Call once at startup before the
 * first log call; tests can inject a sink.
 */
export async function configureLogging(
  level: LogLevel,
  sink: (record: LogRecord) => void = consoleSink,
): Promise<void> {
  await configure({
    sinks: { app: sink },
    loggers: [
      { category: "control-api", sinks: ["app"], lowestLevel: level },
      // LogTape reports its own diagnostics on this category; surface only
      // failures so the info-level setup notice stays out of the output.
      { category: ["logtape", "meta"], sinks: ["app"], lowestLevel: "error" },
    ],
    reset: true,
  });
}
