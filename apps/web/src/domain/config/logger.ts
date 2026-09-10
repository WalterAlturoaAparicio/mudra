/**
 * Structured logging (constitution Principle V).
 *
 * **Per-frame diagnostics are debug level, never info.** That is the engine's real-time-loop
 * rule restated: a message emitted thirty times a second at info level makes the log
 * useless for the events that actually matter, and costs measurable time doing it.
 *
 * The logger holds a level and a sink, both injected. Nothing here reaches for a global.
 */

/** How important a message is. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Structured context attached to a message. */
export type LogFields = Readonly<Record<string, unknown>>;

/** Where log records go. */
export type LogSink = (level: LogLevel, message: string, fields: LogFields) => void;

/** A sink that writes to the browser console. */
export const consoleSink: LogSink = (level, message, fields) => {
  const payload = Object.keys(fields).length > 0 ? [message, fields] : [message];
  switch (level) {
    case 'debug':
      console.debug(...payload);
      break;
    case 'info':
      console.info(...payload);
      break;
    case 'warn':
      console.warn(...payload);
      break;
    case 'error':
      console.error(...payload);
      break;
  }
};

/** A level-filtered structured logger. */
export class Logger {
  private level: LogLevel;
  private readonly sink: LogSink;

  /** @param level Messages below this are dropped without formatting cost. */
  constructor(level: LogLevel = 'info', sink: LogSink = consoleSink) {
    this.level = level;
    this.sink = sink;
  }

  /** Raise or lower the threshold — debug mode turns this down to `debug`. */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** Whether a level would be emitted, so callers can skip building fields. */
  enabled(level: LogLevel): boolean {
    return ORDER[level] >= ORDER[this.level];
  }

  /** Per-frame detail. Never promote one of these to info. */
  debug(message: string, fields: LogFields = {}): void {
    this.emit('debug', message, fields);
  }

  /** Something a person would want to know once, not thirty times a second. */
  info(message: string, fields: LogFields = {}): void {
    this.emit('info', message, fields);
  }

  /** Something degraded but survivable — a stale bundle, a blocked sound. */
  warn(message: string, fields: LogFields = {}): void {
    this.emit('warn', message, fields);
  }

  /** Something failed. */
  error(message: string, fields: LogFields = {}): void {
    this.emit('error', message, fields);
  }

  private emit(level: LogLevel, message: string, fields: LogFields): void {
    if (!this.enabled(level)) {
      return;
    }
    this.sink(level, message, fields);
  }
}
