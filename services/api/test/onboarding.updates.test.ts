import { describe, expect, it, vi } from "vitest";
import { MacStepRequestSchema } from "../src/contracts.js";
import type { CallClaude } from "../src/agent/anthropic.js";
import { InMemoryOnboardingStore, emptyProfile, shouldSendProgress, type UpdateChoice } from "../src/agent/onboarding/index.js";
import { runAgentStep, type StepNotifier } from "../src/agent/step.js";
import { InMemoryTaskStore } from "../src/memory-store.js";

const deviceId = "dev_upd";

async function run(updates: UpdateChoice | null, steps: number) {
  const store = new InMemoryTaskStore();
  const routed = await store.routeInbound({
    providerMessageId: "m1", ownerId: "owner_a", deviceId, text: "open my notes",
    replyProvider: "sendblue", replyHandle: "+15555550100", now: new Date(),
  });
  const taskId = (routed as { taskId: string }).taskId;
  const profiles = new InMemoryOnboardingStore();
  if (updates) await profiles.saveProfile("owner_a", { ...emptyProfile(), updates });
  const sent: string[] = [];
  const notifier: StepNotifier = {
    sendQuestion: async () => {},
    sendResult: async () => {},
    sendProgress: async (_task, text) => { sent.push(text); },
  };
  let n = 0;
  const callClaude: CallClaude = vi.fn(async () => ({
    content: [{ type: "tool_use", id: `u${++n}`, name: "open_app", input: { name: "Notes" } }],
    stop_reason: "tool_use",
  }));
  for (let i = 0; i < steps; i += 1) {
    await runAgentStep({
      store, deviceId, callClaude, notifier, profiles,
      request: MacStepRequestSchema.parse({
        taskId, afterStep: i, results: i ? [{ actionId: `u${i}`, ok: true }] : [],
        screenshot: { mediaType: "image/png", data: "aGVsbG8=", width: 100, height: 100 },
      }),
    });
  }
  return sent;
}

describe("progress texts follow the saved preference", () => {
  it("every step: one text per step, worded by the status strings", async () => {
    expect(await run("every_step", 3)).toEqual(["Opening Notes.", "Opening Notes.", "Opening Notes."]);
  });
  it("every chunk: one text every 5 steps", async () => {
    expect(await run("every_chunk", 10)).toHaveLength(2);
    expect(await run("every_chunk", 4)).toHaveLength(0);
  });
  it("result or no profile: no progress texts", async () => {
    expect(await run("result", 6)).toHaveLength(0);
    expect(await run(null, 6)).toHaveLength(0);
  });
  it("decides by step number only", () => {
    expect(shouldSendProgress("every_chunk", 5)).toBe(true);
    expect(shouldSendProgress("every_chunk", 6)).toBe(false);
    expect(shouldSendProgress(null, 1)).toBe(false);
  });
});
