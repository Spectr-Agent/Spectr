import { SYSTEM_PROMPT } from "./prompt.js";
import { ANTHROPIC_TOOLS } from "./tools.js";
import type { AgentMessage } from "./types.js";

export interface AnthropicRequest {
  model: string;
  max_tokens: 4096;
  system: string;
  tools: typeof ANTHROPIC_TOOLS;
  messages: AgentMessage[];
  /** Cache the growing, append-only history so resending screenshots stays cheap. */
  cache_control: { type: "ephemeral" };
  /** How much the model thinks before it acts. */
  output_config: { effort: Effort };
}

export type Effort = "low" | "medium" | "high";

/**
 * Sonnet 5.5's own default is "high", which spent about 5 s thinking before the first
 * action of a task. At "medium" the first action is the same and comes in about 2 s.
 */
export const DEFAULT_EFFORT: Effort = "medium";

/** Reads ANTHROPIC_EFFORT; anything unrecognized falls back to the default. */
export function readEffort(value: string | undefined): Effort {
  return value === "low" || value === "medium" || value === "high" ? value : DEFAULT_EFFORT;
}

export interface AnthropicResponse {
  content: unknown[];
  /** Why Claude stopped, e.g. "tool_use", "end_turn", "max_tokens" or "refusal". */
  stop_reason?: string | null;
  /** Set on refusals; `category` is safe to log. */
  stop_details?: { category?: string | null } | null;
  /** Token counts, for timing logs; never used for control flow. */
  usage?: Record<string, unknown>;
  /** The model that answered, for timing logs. */
  model?: string;
}

/** Used when ANTHROPIC_MODEL is unset or empty. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

export class AnthropicHttpError extends Error {
  constructor(readonly status: number) {
    super(`Anthropic request failed with HTTP ${status}`);
    this.name = "AnthropicHttpError";
  }
}

export type CallClaude = (
  body: AnthropicRequest,
  opts: { timeoutMs: number },
) => Promise<AnthropicResponse>;

export function createAnthropicCaller(
  apiKey: string,
  fetcher: typeof fetch = globalThis.fetch,
): CallClaude {
  return async (body, opts) => {
    let response: Response;
    try {
      response = await fetcher("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch {
      throw new Error("Anthropic request failed or timed out");
    }
    if (!response.ok) {
      let errorType = "unknown";
      let errorMessage = "Unknown Anthropic error";
      try {
        const payload: unknown = await response.json();
        if (
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "object" &&
          payload.error !== null
        ) {
          const error = payload.error as Record<string, unknown>;
          if (typeof error.type === "string") {
            errorType = error.type;
          }
          if (typeof error.message === "string") {
            errorMessage = error.message;
          }
        }
      } catch {
        // Keep malformed upstream error bodies out of logs.
      }
      console.error(
        "Anthropic request failed",
        response.status,
        errorType,
        errorMessage.slice(0, 300),
      );
      throw new AnthropicHttpError(response.status);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Anthropic response was not valid JSON");
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("content" in payload) ||
      !Array.isArray(payload.content)
    ) {
      throw new Error("Anthropic response did not contain message content");
    }
    const record = payload as Record<string, unknown>;
    const stopReason = typeof record.stop_reason === "string" ? record.stop_reason : null;
    const details = record.stop_details;
    const category =
      typeof details === "object" && details !== null && typeof (details as Record<string, unknown>).category === "string"
        ? ((details as Record<string, unknown>).category as string)
        : null;
    const usage = record.usage;
    return {
      content: payload.content,
      stop_reason: stopReason,
      stop_details: details == null ? null : { category },
      ...(typeof usage === "object" && usage !== null ? { usage: usage as Record<string, unknown> } : {}),
      ...(typeof record.model === "string" ? { model: record.model } : {}),
    };
  };
}

export function anthropicRequest(
  messages: AgentMessage[],
  model = DEFAULT_MODEL,
  effort: Effort = DEFAULT_EFFORT,
): AnthropicRequest {
  return {
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: ANTHROPIC_TOOLS,
    messages,
    cache_control: { type: "ephemeral" },
    output_config: { effort },
  };
}
