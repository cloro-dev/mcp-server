import {
  CREDITS_CHARGED_HEADER,
  CREDITS_REMAINING_HEADER,
} from "../schemas";

import { config } from "../config";


/** The error envelope cloro's API returns on the wire. */
interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
  };
}

// Defensive view of the shared envelope: bodies from a proxy or load
// balancer in front of the API may not conform to it.
interface ApiErrorBody {
  error?: Partial<ApiErrorResponse["error"]>;
}

export interface CloroResponse {
  body: unknown;
  credits?: {
    charged: number;
    remaining: number;
  };
}

/**
 * Thin HTTP client for the public cloro API. Holds the caller's API key and
 * forwards it as a Bearer token — auth, rate limiting, and credit billing all
 * happen in the API itself.
 */
export class CloroClient {
  constructor(private readonly apiKey: string) {}

  async get(path: string): Promise<CloroResponse> {
    return this.request("GET", path);
  }

  async post(path: string, body: unknown): Promise<CloroResponse> {
    return this.request("POST", path, body);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<CloroResponse> {
    let response: Response;
    try {
      response = await fetch(new URL(path, config.apiUrl), {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(
          `cloro API request to ${path} timed out after ${config.requestTimeoutMs / 1000}s. Consider the async task API for long-running scrapes.`,
        );
      }
      throw new Error(
        `cloro API request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const json: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const apiError = (json as ApiErrorBody | undefined)?.error;
      throw new Error(
        `cloro API error ${response.status}${apiError?.code ? ` (${apiError.code})` : ""}: ${apiError?.message ?? "request failed"}${apiError?.details ? ` — ${JSON.stringify(apiError.details)}` : ""}`,
      );
    }

    // The credits middleware sets both headers together on billable (monitor)
    // endpoints; reference endpoints set neither.
    const charged = response.headers.get(CREDITS_CHARGED_HEADER);
    const remaining = response.headers.get(CREDITS_REMAINING_HEADER);
    return {
      body: json,
      credits:
        charged !== null && remaining !== null
          ? { charged: Number(charged), remaining: Number(remaining) }
          : undefined,
    };
  }
}
