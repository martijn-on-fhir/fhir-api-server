import { LoggerService, LogLevel } from '@nestjs/common';

/**
 * JSON-structured logger for production use.
 * Outputs log entries as single-line JSON objects with timestamp, level, context and message.
 * Activated when LOG_FORMAT=json environment variable is set.
 */
export class JsonLoggerService implements LoggerService {

  log(message: any, context?: string) {
    this.writeLog('info', message, context);
  }

  error(message: any, trace?: string, context?: string) {
    this.writeLog('error', message, context, trace);
  }

  warn(message: any, context?: string) {
    this.writeLog('warn', message, context);
  }

  debug(message: any, context?: string) {
    this.writeLog('debug', message, context);
  }

  verbose(message: any, context?: string) {
    this.writeLog('verbose', message, context);
  }

  setLogLevels(_levels: LogLevel[]) {
    // no-op: all levels are always output in JSON mode
  }

  private writeLog(level: string, message: any, context?: string, trace?: string) {

    const entry: Record<string, any> = {
      timestamp: new Date().toISOString(),
      level,
      context: context || 'Application',
      message: typeof message === 'string' ? message : JSON.stringify(message),
    };

    if (trace) {
      entry.trace = trace;
    }

    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + '\n');
  }
}
