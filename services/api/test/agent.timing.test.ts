import { createHash } from "node:crypto";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import type { AnthropicResponse, CallClaude } from "../src/agent/anthropic.js";
import { anthropicRequest, createAnthropicCaller, readEffort } from "../src/agent/anthropic.js";
import { InMemoryOnboardingStore, emptyProfile } from "../src/agent/onboarding/index.js";
import { createMacStepRoute } from "../src/agent/routes.js";
import { runAgentStep, type StepNotifier } from "../src/agent/step.js";
import { newStepTiming, stepTimingLine, timeClaude } from "../src/agent/timing.js";
import { MacStepRequestSchema } from "../src/contracts.js";
import { InMemoryTaskStore } from "../src/memory-store.js";

const deviceId = "dev_timing";
const request = (taskId: string, afterStep = 0) =>
  MacStepRequestSchema.parse({
    taskId,
    afterStep,
    results: [],
    screenshot: { mediaType: "image/png", data: "aGVsbG8=", width: 100, height: 100 },
  });

async function newTask(store: InMemoryTaskStore) {
  const routed = await store.routeInbound({
    providerMessageId: `m-${Math.random()}`,
    ownerId: "owner_t",
    deviceId,
    text: "open my notes",
    replyProvider: "sendblue",
    replyHandle: "+15555550100",
    now: new Date(),
  });
  return (routed as { taskId: string }).taskId;
}

const openNotes: AnthropicResponse = {
  content: [{ type: "tool_use", id: "u1", name: "open_app", input: { name: "Notes" } }],
  stop_reason: "tool_use",
};

describe("timeClaude", () => {
  it("adds each call's duration and token usage", async () => {
    let now = 1_000;
    const call: CallClaude = async () => {
      now += 250;
      return {
        ...openNotes,
        usage: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 40, output_tokens: 60 },
      };
    };
    const timing = newStepTiming();
    const timed = timeClaude(call, timing, () => now);
    await timed({} as never, { timeoutMs: 1 });
    await timed({} as never, { timeoutMs: 1 });
    expect(timing).toEqual({
      claudeMs: 500,
      claudeCalls: 2,
      inputTokens: 20,
      cacheReadTokens: 1_800,
      cacheWriteTokens: 80,
      outputTokens: 120,
      model: null,
    });
  });

  it("counts missing or malformed usage as zero", async () => {
    const timing = newStepTiming();
    await timeClaude(async () => openNotes, timing)({} as never, { timeoutMs: 1 });
    await timeClaude(async () => ({ ...openNotes, usage: { input_tokens: "x" } }), timing)({} as never, { timeoutMs: 1 });
    expect(timing.claudeCalls).toBe(2);
    expect(timing.inputTokens).toBe(0);
  });

  it("still records a failed call and rethrows", async () => {
    const timing = newStepTiming();
    const failing = timeClaude(async () => {
      throw new Error("down");
    }, timing);
    await expect(failing({} as never, { timeoutMs: 1 })).rejects.toThrow("down");
    expect(timing.claudeCalls).toBe(1);
  });
});

describe("stepTimingLine", () => {
  it("is one JSON object with the time outside Claude", () => {
    const timing = { ...newStepTiming(), claudeMs: 700, claudeCalls: 1 };
    const line = JSON.parse(stepTimingLine({ taskId: "t1", afterStep: 2, kind: "actions", totalMs: 900, timing }));
    expect(line).toMatchObject({ event: "step.timing", taskId: "t1", afterStep: 2, kind: "actions", totalMs: 900, claudeMs: 700, otherMs: 200 });
  });

  it("never reports negative time outside Claude", () => {
    const timing = { ...newStepTiming(), claudeMs: 950 };
    expect(JSON.parse(stepTimingLine({ taskId: "t", afterStep: 0, kind: "actions", totalMs: 900, timing })).otherMs).toBe(0);
  });
});

describe("createAnthropicCaller usage", () => {
  it("passes usage through when Claude reports it", async () => {
    const usage = { input_tokens: 5, output_tokens: 7 };
    const fetcher = (async () => Response.json({ content: [], stop_reason: "end_turn", usage })) as typeof fetch;
    const response = await createAnthropicCaller("key", fetcher)({} as never, { timeoutMs: 1_000 });
    expect(response.usage).toEqual(usage);
  });

  it("passes the answering model through", async () => {
    const fetcher = (async () => Response.json({ content: [], model: "claude-sonnet-5-5" })) as typeof fetch;
    const response = await createAnthropicCaller("key", fetcher)({} as never, { timeoutMs: 1_000 });
    expect(response.model).toBe("claude-sonnet-5-5");
  });

  it("leaves usage off when it is missing", async () => {
    const fetcher = (async () => Response.json({ content: [], stop_reason: "end_turn" })) as typeof fetch;
    const response = await createAnthropicCaller("key", fetcher)({} as never, { timeoutMs: 1_000 });
    expect("usage" in response).toBe(false);
  });
});

describe("thinking effort", () => {
  it("defaults to medium and accepts only known levels", () => {
    expect(readEffort(undefined)).toBe("medium");
    expect(readEffort("")).toBe("medium");
    expect(readEffort("max")).toBe("medium");
    expect(readEffort("low")).toBe("low");
    expect(readEffort("high")).toBe("high");
  });

  it("is sent with every request", () => {
    expect(anthropicRequest([]).output_config).toEqual({ effort: "medium" });
    expect(anthropicRequest([], "claude-sonnet-5-5", "low").output_config).toEqual({ effort: "low" });
  });
});

describe("deferred notifications", () => {
  it("hands progress texts to defer and returns the actions without waiting", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await newTask(store);
    const profiles = new InMemoryOnboardingStore();
    await profiles.saveProfile("owner_t", { ...emptyProfile(), updates: "every_step" });
    let releaseSend!: () => void;
    const sendStarted = vi.fn();
    const notifier: StepNotifier = {
      sendQuestion: async () => {},
      sendResult: async () => {},
      sendProgress: () => {
        sendStarted();
        return new Promise<void>((resolve) => {
          releaseSend = resolve;
        });
      },
    };
    const deferred: Promise<void>[] = [];
    const response = await runAgentStep({
      store,
      deviceId,
      request: request(taskId),
      callClaude: async () => openNotes,
      notifier,
      profiles,
      defer: (work) => deferred.push(work),
    });
    expect(response.kind).toBe("actions");
    expect(deferred).toHaveLength(1);
    await vi.waitFor(() => expect(sendStarted).toHaveBeenCalled());
    releaseSend();
    await expect(deferred[0]).resolves.toBeUndefined();
  });
});

describe("step route timing", () => {
  it("logs one step.timing line and defers notifications", async () => {
    const store = new InMemoryTaskStore();
    const token = "spd_timing_token";
    store.deviceTokenHashes.set(createHash("sha256").update(token).digest("hex"), deviceId);
    const taskId = await newTask(store);
    const lines: string[] = [];
    const efforts: string[] = [];
    const defer = vi.fn();
    const sql = Object.assign(async () => [], { json: (value: unknown) => value }) as unknown as postgres.Sql;
    const handler = createMacStepRoute(
      () => ({
        POSTGRES_URL: "postgres://mock:mock@localhost/mock",
        ANTHROPIC_API_KEY: "k",
        ANTHROPIC_EFFORT: "low",
        SPECTR_LINK_SECRET: "s",
        SENDBLUE_API_KEY_ID: "i",
        SENDBLUE_API_SECRET_KEY: "x",
        SENDBLUE_FROM_NUMBER: "+15555550123",
      }),
      () => sql,
      {
        makeStore: () => store,
        callClaude: async (body) => {
          efforts.push(body.output_config.effort);
          return { ...openNotes, model: body.model, usage: { cache_read_input_tokens: 1234 } };
        },
        defer,
        log: (line) => lines.push(line),
      },
    );
    const response = await handler(
      new Request("https://example.test/api/mac/step", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(request(taskId)),
      }),
    );
    expect(response.status).toBe(200);
    expect(efforts).toEqual(["low"]);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event: "step.timing",
      taskId,
      kind: "actions",
      claudeCalls: 1,
      cacheReadTokens: 1234,
      model: "claude-sonnet-5-5",
    });
  });
});
