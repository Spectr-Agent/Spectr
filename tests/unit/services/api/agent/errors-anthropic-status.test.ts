import { describe, expect, it } from "vitest";
import { AnthropicHttpError, createAnthropicCaller } from "../../../../../services/api/src/agent/anthropic.js";
import { ApiErrorException, apiErrorResponse } from "../../../../../services/api/src/agent/errors.js";
import { status, statusForAction, statusForResponse } from "../../../../../services/api/src/agent/status.js";

describe("apiErrorResponse", () => {
  it("serializes an ApiErrorException", async () => {
    const response = apiErrorResponse(new ApiErrorException(409, {
      error: { code: "staleStep", message: "old", currentRevision: 3 },
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "staleStep", currentRevision: 3 } });
  });

  it("maps everything else to a 500 upstream error", async () => {
    const response = apiErrorResponse(new Error("boom"));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "upstreamError" } });
  });
});

describe("createAnthropicCaller", () => {
  const caller = (fetchImpl: typeof fetch) => createAnthropicCaller("key", fetchImpl);
  const body = { model: "m", max_tokens: 4096, system: "s", tools: [], messages: [], cache_control: { type: "ephemeral" } } as never;

  it("maps a fetch failure to a request error", async () => {
    const call = caller((async () => { throw new Error("down"); }) as typeof fetch);
    await expect(call(body, { timeoutMs: 1000 })).rejects.toThrow("Anthropic request failed or timed out");
  });

  it.each([
    [{ error: { type: "rate_limit_error", message: "slow down" } }, 429],
    [{ error: { type: 5 } }, 500],
    ["not json", 503],
  ])("raises AnthropicHttpError for upstream errors %j", async (payload, httpStatus) => {
    const call = caller((async () =>
      new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status: httpStatus }),
    ) as typeof fetch);
    await expect(call(body, { timeoutMs: 1000 })).rejects.toThrow(AnthropicHttpError);
    await expect(call(body, { timeoutMs: 1000 })).rejects.toThrow(`HTTP ${httpStatus}`);
  });

  it.each([
    ["not json", "not valid JSON"],
    [JSON.stringify({}), "did not contain message content"],
    [JSON.stringify({ content: "nope" }), "did not contain message content"],
  ])("rejects malformed success bodies", async (raw, message) => {
    const call = caller((async () => new Response(raw, { status: 200 })) as typeof fetch);
    await expect(call(body, { timeoutMs: 1000 })).rejects.toThrow(message);
  });
});

describe("status helpers", () => {
  it("falls back to 'the site' for an unparsable URL", () => {
    expect(statusForAction({ type: "openUrl", url: "::::" })).toContain("the site");
  });

  it("reports success and failure for finished responses", () => {
    expect(statusForResponse({
      kind: "finished", taskId: "t", step: 1, state: "succeeded", summary: "Done it",
    })).toBe(status("done", { summary: "Done it" }));
    expect(statusForResponse({
      kind: "finished", taskId: "t", step: 1, state: "failed", summary: "Nope",
    })).toBe(status("failed", { summary: "Nope" }));
    expect(statusForResponse({
      kind: "finished", taskId: "t", step: 1, state: "cancelled", summary: "Stopped.",
    })).toBe(status("stopped"));
  });
});

describe("statusForResponse other kinds", () => {
  it("describes the main action and falls back when only housekeeping runs", () => {
    expect(statusForResponse({
      kind: "actions", taskId: "t", step: 1,
      actions: [
        { actionId: "s", action: { type: "screenshot" } },
        { actionId: "c", action: { type: "click", x: 1, y: 2, button: "left", clicks: 1, modifiers: [] } },
      ],
    })).toBe(statusForAction({ type: "click", x: 1, y: 2, button: "left", clicks: 1, modifiers: [] }));
    expect(statusForResponse({
      kind: "actions", taskId: "t", step: 1,
      actions: [{ actionId: "w", action: { type: "wait", seconds: 1 } }],
    })).toBe(statusForAction({ type: "wait", seconds: 1 }));
  });

  it("shows the question for waiting responses", () => {
    expect(statusForResponse({ kind: "waiting", taskId: "t", step: 1, question: "Send it?" }))
      .toBe(status("question", { question: "Send it?" }));
  });
});
