/**
 * Logger for server output. Uses console so logs show in the terminal
 * when running locally (e.g. `bun run dev`) and in Docker.
 */

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  return String(err);
}

/**
 * Log an info message. Use context (e.g. "Server", "WebSocket") and message.
 */
export function info(context: string, message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${context}] ${message}`);
}

/**
 * Log an error. Use context (e.g. "WebSocket", "Auth") and message; optional error object for stack traces.
 */
export function error(context: string, message: string, err?: unknown): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${context}] ERROR: ${message}`);
  if (err !== undefined && err !== null) {
    console.error(formatError(err));
  }
}
