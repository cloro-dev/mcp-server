/**
 * Tool-call instrumentation.
 *
 * The hosted deployment wraps this with Prometheus counters and histograms
 * from cloro's internal metrics package. That package is cluster
 * infrastructure and is not part of this repo, so here the wrapper only times
 * the call and logs failures. The behaviour of a tool call is identical
 * either way.
 */
import { logger } from "./logger";

export async function observeToolCall<T>(
  tool: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    logger.info(`${tool} ok in ${Date.now() - startedAt}ms`, "MCP");
    return result;
  } catch (error) {
    logger.error(
      `${tool} failed in ${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : String(error)}`,
      "MCP",
    );
    throw error;
  }
}
