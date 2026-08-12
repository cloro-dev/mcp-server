/**
 * Minimal logger.
 *
 * In stdio mode stdout carries the JSON-RPC stream, so every line goes to
 * stderr regardless of level — writing to stdout would corrupt the protocol.
 *
 * The signature mirrors cloro's internal logger so call sites are identical in
 * this repo and in the hosted deployment.
 */
type Level = "info" | "warn" | "error";

function write(
  level: Level,
  message: string,
  scope?: string,
  context?: Record<string, unknown>,
  error?: unknown,
): void {
  const parts = [new Date().toISOString(), level];
  if (scope) parts.push(`[${scope}]`);
  parts.push(message);
  if (context && Object.keys(context).length > 0) parts.push(JSON.stringify(context));
  if (error !== undefined) {
    parts.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
  process.stderr.write(`${parts.join(" ")}\n`);
}

export const logger = {
  info: (message: string, scope?: string, context?: Record<string, unknown>) =>
    write("info", message, scope, context),
  warn: (message: string, scope?: string, context?: Record<string, unknown>) =>
    write("warn", message, scope, context),
  error: (
    message: string,
    scope?: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ) => write("error", message, scope, context, error),
};
