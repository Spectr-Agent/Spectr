import { describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../../../../services/api/src/memory-store.js";

const inbound = (over: object = {}) => ({
  providerMessageId: "msg_1",
  ownerId: "owner",
  deviceId: "mac-1",
  text: "do the thing",
  replyProvider: "sendblue" as const,
  replyHandle: "+1",
  now: new Date("2025-01-01T00:00:00Z"),
  ...over,
});

describe("InMemoryTaskStore gaps", () => {
  it("fails a stale active task instead of routing to it", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await store.routeInbound(inbound());
    // Age the task past the 15 minute staleness window.
    const stale = new Date("2025-01-01T00:20:00Z");
    const routed = await store.routeInbound(inbound({ providerMessageId: "msg_2", text: "next", now: stale }));
    expect(routed.taskId).not.toBe(taskId);
    expect(await store.getTask(taskId)).toMatchObject({ state: "failed", summary: "I'm afraid I've lost the connection to your Mac." });
  });

  it("sweeps stale tasks in getActiveTaskForDevice too", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await store.routeInbound(inbound());
    expect(await store.getActiveTaskForDevice("mac-1", new Date("2025-01-01T00:10:00Z"))).toMatchObject({ taskId });
    expect(await store.getActiveTaskForDevice("mac-1", new Date("2025-01-01T00:20:00Z"))).toBeNull();
    expect(await store.getTask(taskId)).toMatchObject({ state: "failed" });
  });

  it("consumes matching inbound ids when a step is persisted", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await store.routeInbound(inbound());
    await store.routeInbound(inbound({ providerMessageId: "msg_2", text: "also this" }));
    const task = (await store.getTask(taskId))!;
    const pending = await store.getUnconsumedInboundMessages(taskId);
    expect(pending.map((m) => m.providerMessageId)).toEqual(["msg_2"]);

    const updated = await store.persistAgentStep({
      taskId,
      expectedStepCount: task.stepCount,
      expectedRevision: task.revision,
      stepCount: 1,
      state: "running",
      question: null,
      agentMessages: [],
      pendingToolResults: [],
      lastStepResponse: { kind: "actions", taskId, step: 1, revision: task.revision, actions: [{ actionId: "a1", action: { type: "wait", seconds: 1 } }] },
      screenWidth: 1280,
      screenHeight: 800,
      summary: null,
      finalScreenshot: null,
      finalScreenshotType: null,
      consumedInboundIds: ["msg_2", "msg_unknown"],
      now: new Date("2025-01-01T00:01:00Z"),
    });
    expect(updated).toBe(true);
    expect(await store.getUnconsumedInboundMessages(taskId)).toEqual([]);
  });

  it("claims a result notification once", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await store.routeInbound(inbound());
    expect(await store.claimResultNotification(taskId, new Date())).toBeNull();
    const task = (await store.getTask(taskId))!;
    task.state = "succeeded";
    const now = new Date("2025-01-01T00:05:00Z");
    expect(await store.claimResultNotification(taskId, now)).toMatchObject({ taskId, state: "succeeded" });
    expect(await store.claimResultNotification(taskId, now)).toBeNull();
  });

  it("marks inbound replies sent only once", async () => {
    const store = new InMemoryTaskStore();
    expect(await store.isInboundReplySent("msg_1")).toBe(false);
    await store.routeInbound(inbound());
    await store.markInboundReplySent("msg_1");
    expect(await store.isInboundReplySent("msg_1")).toBe(true);
    await store.markInboundReplySent("missing");
  });
});

describe("persistAgentStep guard", () => {
  it("returns false when the expected step, revision or state no longer match", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await store.routeInbound({
      providerMessageId: "m1", ownerId: "o", deviceId: "d", text: "task",
      replyProvider: "sendblue", replyHandle: "+1", now: new Date(),
    });
    const base = {
      taskId, expectedStepCount: 0, expectedRevision: 1, stepCount: 1,
      state: "running" as const, question: null, summary: null,
      lastStepResponse: { kind: "actions" as const, taskId, step: 1, revision: 1, actions: [] },
      screenWidth: 100, screenHeight: 100, finalScreenshot: null, finalScreenshotType: null,
      agentMessages: [], pendingToolResults: [], consumedInboundIds: [], now: new Date(),
    };
    // Wrong step, wrong revision and a terminal state all refuse the write.
    expect(await store.persistAgentStep({ ...base, expectedStepCount: 9 })).toBe(false);
    expect(await store.persistAgentStep({ ...base, expectedRevision: 9 })).toBe(false);
    const task = (await store.getTask(taskId))!;
    task.state = "succeeded";
    expect(await store.persistAgentStep(base)).toBe(false);
  });
});
