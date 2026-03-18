import "server-only";

export interface LogEvent {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  traceId?: string;
  orgId?: string;
  runId?: string;
  taskId?: string;
  jobName?: string;
  event: string;
  message: string;
  meta?: Record<string, unknown>;
}

function toLine(event: LogEvent) {
  return JSON.stringify(event);
}

export function logInfo(event: Omit<LogEvent, "ts" | "level">) {
  // eslint-disable-next-line no-console
  console.info(toLine({ ...event, ts: new Date().toISOString(), level: "info" }));
}

export function logWarn(event: Omit<LogEvent, "ts" | "level">) {
  // eslint-disable-next-line no-console
  console.warn(toLine({ ...event, ts: new Date().toISOString(), level: "warn" }));
}

export function logError(event: Omit<LogEvent, "ts" | "level">) {
  // eslint-disable-next-line no-console
  console.error(toLine({ ...event, ts: new Date().toISOString(), level: "error" }));
}
