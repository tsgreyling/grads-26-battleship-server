/**
 * Error-only logger. All output goes to stderr with a consistent format.
 */

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  return String(err);
}

/**
 * Log an error. Use context (e.g. "WebSocket", "Auth") and message; optional error object for stack traces.
 */
export function error(context: string, message: string, err?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${context}] ERROR: ${message}`;
  if (err !== undefined && err !== null) {
    console.error(prefix, "\n", formatError(err));
  } else {
    console.error(prefix);
  }
}
