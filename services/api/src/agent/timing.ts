// Per-step timing, logged as one JSON line so `vercel logs` shows where a step's time
// goes: Claude versus everything else (database, notifications, the function itself).
// Token counts show whether prompt caching is working (cacheReadTokens > 0).

import type { CallClaude } from "./anthropic.js";

export interface StepTiming {
  claudeMs: number;
  claudeCalls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** The model that answered the last call, or null before any answer. */
  model: string | null;
}

export function newStepTiming(): StepTiming {
  return {
    claudeMs: 0,
    claudeCalls: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    model: null,
  };
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Wraps a Claude caller so every call adds its duration and token usage to `timing`. */
export function timeClaude(call: CallClaude, timing: StepTiming, clock: () => number = Date.now): CallClaude {
  return async (body, opts) => {
    const started = clock();
    try {
      const response = await call(body, opts);
      const usage = response.usage ?? {};
      timing.inputTokens += count(usage.input_tokens);
      timing.cacheReadTokens += count(usage.cache_read_input_tokens);
      timing.cacheWriteTokens += count(usage.cache_creation_input_tokens);
      timing.outputTokens += count(usage.output_tokens);
      if (response.model) timing.model = response.model;
      return response;
    } finally {
      timing.claudeMs += clock() - started;
      timing.claudeCalls += 1;
    }
  };
}

export function stepTimingLine(fields: {
  taskId: string;
  afterStep: number;
  kind: string;
  totalMs: number;
  timing: StepTiming;
}): string {
  const { timing, ...rest } = fields;
  return JSON.stringify({
    event: "step.timing",
    ...rest,
    ...timing,
    otherMs: Math.max(0, fields.totalMs - timing.claudeMs),
  });
}
