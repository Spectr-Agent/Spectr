import { describe, expect, it, vi } from "vitest";
import { AnthropicHttpError } from "../../../../../services/api/src/agent/anthropic.js";
import { runAgentStep, type StepNotifier } from "../../../../../services/api/src/agent/step.js";
import { InMemoryTaskStore } from "../../../../../services/api/src/memory-store.js";
import {
  computer,
  custom,
  deviceId,
  reply,
  request,
  route,
  scriptedClaude,
} from "../../../../../services/api/test/helpers/agent-loop.js";

async function newTask() {
  const store = new InMemoryTaskStore();
  const { taskId } = await route(store, "write milk in Notes");
  return { store, taskId };
}

const notifier = (over: Partial<StepNotifier> = {}): StepNotifier => ({
  sendQuestion: vi.fn(async () => undefined),
  sendResult: vi.fn(async () => undefined),
  ...over,
});

describe("runAgentStep task states", () => {
  it("404s an unknown task", async () => {
    const store = new InMemoryTaskStore();
    await expect(runAgentStep({
      store,
      deviceId,
      request: request("tsk_missing"),
      callClaude: async () => reply(),
    })).rejects.toMatchObject({ status: 404 });
  });

  it("replays a terminal response and answers waiting tasks without calling Claude", async () => {
    const { store, taskId } = await newTask();
    const callClaude = vi.fn(async () => reply());
    // Cancel via a stop text, then step: terminal response without a stored finished response.
    await route(store, "stop", "msg_stop");
    const cancelled = await runAgentStep({ store, deviceId, request: request(taskId), callClaude });
    expect(cancelled).toMatchObject({ kind: "finished", state: "cancelled", summary: "Stopped." });
    expect(callClaude).not.toHaveBeenCalled();

    // Waiting state returns the open question.
    const { store: s2, taskId: t2 } = await newTask();
    const task = (await s2.getTask(t2))!;
    task.state = "waitingForUser";
    task.question = "Send it?";
    const waiting = await runAgentStep({ store: s2, deviceId, request: request(t2), callClaude });
    expect(waiting).toMatchObject({ kind: "waiting", question: "Send it?" });
  });

  it("replays the last response for a repeated step and 409s a stale one", async () => {
    const { store, taskId } = await newTask();
    const task = (await store.getTask(taskId))!;
    task.stepCount = 2;
    task.lastStepResponse = { kind: "actions", taskId, step: 2, revision: 1, actions: [{ actionId: "a", action: { type: "wait", seconds: 1 } }] };

    const replayed = await runAgentStep({
      store, deviceId, request: request(taskId, { afterStep: 1 }), callClaude: async () => reply(),
    });
    expect(replayed).toEqual(task.lastStepResponse);
    await expect(runAgentStep({
      store, deviceId, request: request(taskId, { afterStep: 5 }), callClaude: async () => reply(),
    })).rejects.toMatchObject({ status: 409 });
  });

  it("fails a task that reaches the step cap", async () => {
    const { store, taskId } = await newTask();
    const task = (await store.getTask(taskId))!;
    task.stepCount = 60;
    const sendResult = vi.fn(async () => undefined);
    const response = await runAgentStep({
      store, deviceId, request: request(taskId, { afterStep: 60 }),
      callClaude: async () => reply(),
      notifier: notifier({ sendResult }),
      linkSecret: "seal",
    });
    expect(response).toMatchObject({ kind: "finished", state: "failed", summary: "I'm afraid that took too many steps, so I've stopped." });
    expect(sendResult).toHaveBeenCalledWith(expect.objectContaining({ taskId }), expect.any(String), expect.stringContaining("sig="), `result-${taskId}`);
  });
});

describe("runAgentStep first turn", () => {
  it("puts corrections and answers into the first message", async () => {
    const { store, taskId } = await newTask();
    await route(store, "actually add eggs", "msg_c");
    const claude = scriptedClaude(reply(computer("c1", "wait", { duration: 0 })));
    await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    const first = JSON.stringify(claude.sent[0]?.messages[0]?.content);
    expect(first).toContain("actually add eggs");
  });

  it.each([
    [400, "error 400"],
    [401, "error 401"],
  ])("finishes failed on a non-retryable Anthropic %i", async (httpStatus, part) => {
    const { store, taskId } = await newTask();
    const response = await runAgentStep({
      store, deviceId, request: request(taskId),
      callClaude: async () => { throw new AnthropicHttpError(httpStatus); },
    });
    expect(response).toMatchObject({ kind: "finished", state: "failed" });
    expect((response as { summary?: string }).summary).toContain(part);
  });

  it("maps retryable failures and bad responses to a 502", async () => {
    const { store, taskId } = await newTask();
    await expect(runAgentStep({
      store, deviceId, request: request(taskId),
      callClaude: async () => { throw new AnthropicHttpError(500); },
    })).rejects.toMatchObject({ status: 502 });
    await expect(runAgentStep({
      store, deviceId, request: request(taskId),
      callClaude: async () => ({ content: "not-an-array" }) as never,
    })).rejects.toMatchObject({ status: 502 });
    await expect(runAgentStep({
      store, deviceId, request: request(taskId),
      callClaude: async () => reply({ type: "tool_use", name: "left_click", input: {}, toolset_name: "computer" }),
    })).rejects.toMatchObject({ status: 502 });
  });

  it("retries once when Claude returns no tool use, then fails after the cap", async () => {
    const { store, taskId } = await newTask();
    const textOnly = { content: [{ type: "text", text: "let me think" }], stop_reason: "end_turn" };
    const claude = scriptedClaude(textOnly, textOnly, textOnly, textOnly);
    const response = await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    expect(response).toMatchObject({ kind: "finished", state: "failed", summary: "let me think" });
  });

  it("fails with the refusal summary when Claude declines", async () => {
    const { store, taskId } = await newTask();
    const response = await runAgentStep({
      store, deviceId, request: request(taskId),
      callClaude: async () => ({ content: [], stop_reason: "refusal" }),
    });
    expect(response).toMatchObject({ kind: "finished", state: "failed" });
    expect((response as { summary?: string }).summary).toContain("can't");
  });

  it("fails with the cut-off summary on max_tokens without tool use", async () => {
    const { store, taskId } = await newTask();
    const response = await runAgentStep({
      store, deviceId, request: request(taskId),
      callClaude: async () => ({ content: [{ type: "text", text: "half" }], stop_reason: "max_tokens" }),
    });
    expect(response).toMatchObject({ kind: "finished", state: "failed" });
  });
});

describe("runAgentStep tool mapping", () => {
  it("waits for the user on a lone ask_user and notifies", async () => {
    const { store, taskId } = await newTask();
    const sendQuestion = vi.fn(async () => undefined);
    const response = await runAgentStep({
      store, deviceId, request: request(taskId),
      callClaude: scriptedClaude(reply(custom("a1", "ask_user", { question: "Send it?" }))).call,
      notifier: notifier({ sendQuestion }),
    });
    expect(response).toMatchObject({ kind: "waiting", question: "Send it?" });
    expect(sendQuestion).toHaveBeenCalledWith(expect.objectContaining({ taskId }), "Send it?", `question-${taskId}-2`);
  });

  it("swallows notifier failures", async () => {
    const { store, taskId } = await newTask();
    const response = await runAgentStep({
      store, deviceId, request: request(taskId),
      callClaude: scriptedClaude(reply(custom("a1", "ask_user", { question: "ok?" }))).call,
      notifier: notifier({ sendQuestion: async () => { throw new Error("sms down"); } }),
    });
    expect(response).toMatchObject({ kind: "waiting" });
  });

  it("finishes on a lone finish and reports the result", async () => {
    const { store, taskId } = await newTask();
    const sendResult = vi.fn(async () => undefined);
    const response = await runAgentStep({
      store, deviceId, request: request(taskId),
      callClaude: scriptedClaude(reply(custom("f1", "finish", { success: false, summary: "could not" }))).call,
      notifier: notifier({ sendResult }),
      linkSecret: "seal",
    });
    expect(response).toMatchObject({ kind: "finished", state: "failed", summary: "could not" });
    expect(sendResult).toHaveBeenCalled();
  });

  it("marks control tools used with others as invalid, then recovers", async () => {
    const { store, taskId } = await newTask();
    const claude = scriptedClaude(
      reply(
        computer("c1", "left_click", { coordinate: [1, 1] }),
        custom("f1", "finish", { success: true, summary: "done" }),
      ),
      reply(custom("f2", "finish", { success: true, summary: "done now" })),
    );
    const response = await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    // Mixing a control tool with actions fails the whole batch; the retry finishes.
    expect(response).toMatchObject({ kind: "finished", state: "succeeded", summary: "done now" });
    const retry = JSON.stringify(claude.sent[1]?.messages.at(-1)?.content);
    expect(retry).toContain("by itself in its own turn");
  });

  it("sends tool input errors back and retries", async () => {
    const { store, taskId } = await newTask();
    const claude = scriptedClaude(
      reply(computer("c1", "left_click", { coordinate: [9999, 1] })),
      reply(custom("f1", "finish", { success: true, summary: "ok" })),
    );
    const response = await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    expect(response).toMatchObject({ kind: "finished", state: "succeeded" });
    const second = JSON.stringify(claude.sent[1]?.messages.at(-1)?.content);
    expect(second).toContain("outside the latest screenshot");
  });

  it("fails after the per-step call cap when every batch is invalid", async () => {
    const { store, taskId } = await newTask();
    const bad = reply(computer("c1", "teleport", {}));
    const claude = scriptedClaude(bad, bad, bad, bad, bad);
    const response = await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    expect(response).toMatchObject({ kind: "finished", state: "failed" });
  });
});

describe("runAgentStep second turn", () => {
  async function twoTurnTask() {
    const { store, taskId } = await newTask();
    const claude = scriptedClaude(
      reply(
        computer("shot", "screenshot", {}),
        computer("click", "left_click", { coordinate: [1, 1] }),
        computer("click2", "left_click", { coordinate: [2, 2] }),
      ),
      reply(custom("f1", "finish", { success: true, summary: "done" })),
    );
    await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    return { store, taskId, claude };
  }

  it("reports a failed action and halts later ones", async () => {
    const { store, taskId, claude } = await twoTurnTask();
    const response = await runAgentStep({
      store, deviceId,
      request: request(taskId, {
        afterStep: 1,
        results: [
          { actionId: "shot", ok: true },
          { actionId: "click", ok: false, error: "missed" },
          { actionId: "click2", ok: true },
        ],
      }),
      callClaude: claude.call,
    });
    expect(response).toMatchObject({ kind: "finished" });
    const last = JSON.stringify(claude.sent[1]?.messages.at(-1)?.content);
    expect(last).toContain("missed");
    expect(last).toContain("an earlier computer action in this turn failed");
  });

  it("reports a missing action result", async () => {
    const { store, taskId, claude } = await twoTurnTask();
    await runAgentStep({
      store, deviceId,
      request: request(taskId, { afterStep: 1, results: [{ actionId: "shot", ok: true }] }),
      callClaude: claude.call,
    });
    const last = JSON.stringify(claude.sent[1]?.messages.at(-1)?.content);
    expect(last).toContain("no result was received");
  });

  it("threads answers into ask_user tool results", async () => {
    const { store, taskId } = await newTask();
    const claude = scriptedClaude(
      reply(custom("ask1", "ask_user", { question: "Send it?" })),
      reply(custom("f1", "finish", { success: true, summary: "sent" })),
    );
    await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    // The user answers while waiting.
    await route(store, "yes", "msg_yes");
    await runAgentStep({ store, deviceId, request: request(taskId, { afterStep: 1 }), callClaude: claude.call });
    const last = JSON.stringify(claude.sent[1]?.messages.at(-1)?.content);
    expect(last).toContain("replied:");
  });

  it("says no reply was received for an unanswered ask_user", async () => {
    const { store, taskId } = await newTask();
    const claude = scriptedClaude(
      reply(custom("ask1", "ask_user", { question: "Send it?" })),
      reply(custom("f1", "finish", { success: true, summary: "done" })),
    );
    await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    // Resume without any inbound answer.
    const task = (await store.getTask(taskId))!;
    task.state = "running";
    task.question = null;
    await runAgentStep({ store, deviceId, request: request(taskId, { afterStep: 1 }), callClaude: claude.call });
    const last = JSON.stringify(claude.sent[1]?.messages.at(-1)?.content);
    expect(last).toContain("no user reply was received");
  });
});

describe("runAgentStep conflict and deadline", () => {
  it("returns the cancelled terminal response when a stop lands mid-step", async () => {
    const { store, taskId } = await newTask();
    const task = (await store.getTask(taskId))!;
    const real = store.persistAgentStep.bind(store);
    store.persistAgentStep = async (input) => {
      task.state = "cancelled";
      task.summary = "Stopped.";
      void real;
      return false;
    };
    const claude = scriptedClaude(reply(computer("c1", "wait", { duration: 0 })));
    const response = await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    expect(response).toMatchObject({ kind: "finished", state: "cancelled", summary: "Stopped." });
  });

  it("409s when the task changed mid-step without cancelling", async () => {
    const { store, taskId } = await newTask();
    store.persistAgentStep = async () => false;
    const claude = scriptedClaude(reply(computer("c1", "wait", { duration: 0 })));
    await expect(runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("maps a blown deadline to a 502", async () => {
    const { store, taskId } = await newTask();
    let tick = 0;
    const claude = scriptedClaude(reply(computer("c1", "wait", { duration: 0 })));
    await expect(runAgentStep({
      store, deviceId, request: request(taskId), callClaude: claude.call,
      clock: () => (tick += 500_000),
    })).rejects.toMatchObject({ status: 502 });
  });
});

describe("runAgentStep turn construction gaps", () => {
  const finishReply = () => reply({ type: "tool_use", id: "f1", name: "finish", input: { success: true, summary: "done" } });
  const makeTask = async () => {
    const { store, taskId } = await newTask();
    const task = (await store.getTask(taskId))!;
    return { store, taskId, task };
  };

  it("includes a pending answer in the first turn", async () => {
    const { store, taskId, task } = await makeTask();
    task.state = "waitingForUser";
    task.question = "Send it?";
    await route(store, "yes", "msg_a");
    const claude = scriptedClaude(finishReply());
    await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    const first = JSON.stringify(claude.sent[0]?.messages[0]?.content);
    expect(first).toContain('The user replied: \\"yes\\"');
  });

  it("rebuilds context from a non-array assistant record and threads answers", async () => {
    const { store, taskId, task } = await makeTask();
    task.stepCount = 1;
    // A malformed stored assistant turn: tool-use recovery returns no blocks.
    task.agentMessages = [{ role: "assistant", content: "corrupted" }];
    task.state = "waitingForUser";
    task.question = "ok?";
    await route(store, "yes", "msg_a");
    await route(store, "and add eggs", "msg_c"); // correction while running
    const claude = scriptedClaude(finishReply());
    await runAgentStep({ store, deviceId, request: request(taskId, { afterStep: 1 }), callClaude: claude.call });
    const next = JSON.stringify(claude.sent[0]?.messages.at(-1)?.content);
    expect(next).toContain("and add eggs");
  });

  it("threads an answer alongside action results when no question was asked", async () => {
    const { store, taskId, task } = await makeTask();
    task.stepCount = 1;
    task.agentMessages = [
      { role: "user", content: [{ type: "text", text: "task" }] },
      { role: "assistant", content: [computer("a1", "left_click", { coordinate: [1, 2] })] },
    ];
    task.state = "waitingForUser";
    task.question = "q";
    await route(store, "yes", "msg_a");
    const claude = scriptedClaude(finishReply());
    await runAgentStep({
      store, deviceId,
      request: request(taskId, { afterStep: 1, results: [{ actionId: "a1", ok: true, output: "OK" }] }),
      callClaude: claude.call,
    });
    const next = JSON.stringify(claude.sent[0]?.messages.at(-1)?.content);
    expect(next).toContain('The user replied: \\"yes\\"');
  });

  it.each([
    [[{ actionId: "s1", ok: false, error: "denied" }], "denied"],
    [[], "no result was received"],
    [[{ actionId: "s1", ok: true }], "image/png"],
  ])("reports screenshot results to Claude (%j)", async (results, part) => {
    const { store, taskId, task } = await makeTask();
    task.stepCount = 1;
    task.agentMessages = [
      { role: "user", content: [{ type: "text", text: "task" }] },
      { role: "assistant", content: [computer("s1", "screenshot")] },
    ];
    const claude = scriptedClaude(finishReply());
    await runAgentStep({
      store, deviceId,
      request: request(taskId, { afterStep: 1, results }),
      callClaude: claude.call,
    });
    const next = JSON.stringify(claude.sent[0]?.messages.at(-1)?.content);
    expect(next).toContain(part);
  });

  it("retries once when a lone control tool is malformed, then finishes", async () => {
    const { store, taskId } = await makeTask();
    const claude = scriptedClaude(
      reply({ type: "tool_use", id: "q1", name: "ask_user", input: {} }),
      finishReply(),
    );
    const response = await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    expect(response).toMatchObject({ kind: "finished" });
    expect(claude.sent).toHaveLength(2);
  });

  it("returns valid actions from a batch and reports the invalid one next turn", async () => {
    const { store, taskId } = await makeTask();
    const claude = scriptedClaude(
      reply(computer("w1", "wait", { duration: 0 }), custom("u1", "open_url", { url: "ftp://x" })),
      finishReply(),
    );
    const first = await runAgentStep({ store, deviceId, request: request(taskId), callClaude: claude.call });
    // The valid wait action still ships; the bad url becomes an error result.
    expect(first).toMatchObject({ kind: "actions" });
    const { task: taskAfter } = { task: (await store.getTask(taskId))! };
    expect(taskAfter.pendingToolResults.some((r) => JSON.stringify(r).includes("http and https"))).toBe(true);
  });

  it("skips result notification when the claim fails or the handle is gone", async () => {
    const { store, taskId } = await makeTask();
    const claim = store.claimResultNotification.bind(store);
    store.claimResultNotification = async () => null;
    const sendResult = vi.fn(async () => undefined);
    await runAgentStep({
      store, deviceId, request: request(taskId), callClaude: async () => finishReply(),
      notifier: notifier({ sendResult }), linkSecret: "seal",
    });
    expect(sendResult).not.toHaveBeenCalled();

    const { store: store2, taskId: t2 } = await newTask();
    store2.claimResultNotification = async (id, now) => {
      const claimed = await store2.getTask(id);
      void now;
      return claimed ? { ...claimed, replyHandle: null } : null;
    };
    const sendResult2 = vi.fn(async () => undefined);
    await runAgentStep({
      store: store2, deviceId, request: request(t2), callClaude: async () => finishReply(),
      notifier: notifier({ sendResult: sendResult2 }), linkSecret: "seal",
    });
    expect(sendResult2).not.toHaveBeenCalled();
    void claim;
  });
});
