import { describe, expect, it, vi } from "vitest";
import { CallSession, type CallOutput } from "../../../../services/call-agent/src/call.js";
import type { Caller, TaskGateway } from "../../../../services/call-agent/src/tasks.js";
import { FIRST_WORDING, type TaskStatus } from "../../../../services/call-agent/src/conversation.js";

const caller: Caller = { ownerId: "u1", deviceId: "d1", handle: "+1" };

function setup(tasks: Partial<TaskGateway> = {}, pollMs = 0) {
  const said: string[] = [];
  const output: CallOutput = { say: (t) => said.push(t), hangUp: vi.fn() };
  const gateway: TaskGateway = {
    route: vi.fn(async () => ({ taskId: "t1", kind: "task" as const })),
    status: vi.fn(async () => null),
    activeTask: vi.fn(async () => null),
    ...tasks,
  };
  const session = new CallSession("c1", "phone", caller, gateway, output, { pollMs, phrasing: FIRST_WORDING });
  return { session, said, output, gateway };
}

describe("CallSession", () => {
  it("greets and picks up a running task", async () => {
    const task: TaskStatus = { taskId: "t9", state: "running", revision: 1, question: null, summary: null };
    const { session, said } = setup({ activeTask: async () => task });
    await session.begin();
    expect(session.task).toEqual(task);
    expect(said[0]).toContain("Spectr");
  });

  it("survives a broken activeTask lookup", async () => {
    const { session } = setup({ activeTask: async () => { throw new Error("db down"); } });
    await session.begin();
    expect(session.task).toBeNull();
  });

  it("ignores noise and re-greets while idle", async () => {
    const { session, said } = setup();
    await session.begin();
    said.length = 0;
    await session.hear("m");
    await session.hear("hello");
    expect(said).toHaveLength(1);
  });

  it("routes utterances with a per-turn utterance id", async () => {
    const { session, gateway } = setup({ status: async () => ({ taskId: "t1", state: "accepted", revision: 1, question: null, summary: null }) });
    await session.begin();
    await session.hear("open Notes and write milk");
    await session.hear("actually add eggs too");
    expect(gateway.route).toHaveBeenNthCalledWith(1, caller, "open Notes and write milk", "call:c1:1");
    expect(gateway.route).toHaveBeenNthCalledWith(2, caller, "actually add eggs too", "call:c1:2");
    expect(session.task?.state).toBe("accepted");
  });

  it("says the fallback when routing fails", async () => {
    const { session, said } = setup({ route: async () => { throw new Error("down"); } });
    await session.begin();
    said.length = 0;
    await session.hear("do something");
    expect(said).toEqual([
      "[cheerfully] Right away.",
      "[apologetic] I'm afraid I couldn't reach your Mac's task list. Please try again in a moment.",
    ]);
  });

  it("hangs up on goodbye and stops processing", async () => {
    const { session, output, gateway } = setup();
    await session.begin();
    await session.hear("goodbye");
    expect(output.hangUp).toHaveBeenCalled();
    await session.hear("do something");
    expect(gateway.route).not.toHaveBeenCalled();
  });

  it("narrates new task states during polling", async () => {
    const waiting: TaskStatus = { taskId: "t1", state: "waitingForUser", revision: 2, question: "Send it?", summary: null };
    const { session, said } = setup({
      activeTask: async () => ({ taskId: "t1", state: "running", revision: 1, question: null, summary: null }),
      status: async () => waiting,
    });
    await session.begin();
    await session.poll();
    await session.poll();
    expect(said.filter((s) => s === "[curious] Send it?")).toHaveLength(1);
  });

  it("polls on a timer and survives status errors", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const { session } = setup({
        activeTask: async () => ({ taskId: "t1", state: "running", revision: 1, question: null, summary: null }),
        status: async () => (n += 1) === 1 ? Promise.reject(new Error("x")) : { taskId: "t1", state: "succeeded", revision: 1, question: null, summary: null },
      }, 10);
      await session.begin();
      await vi.advanceTimersByTimeAsync(25);
      session.end();
    } finally {
      vi.useRealTimers();
    }
  });

  it("end stops the polling timer", async () => {
    vi.useFakeTimers();
    try {
      const { session, gateway } = setup({
        activeTask: async () => ({ taskId: "t1", state: "running", revision: 1, question: null, summary: null }),
      }, 10);
      await session.begin();
      session.end();
      await vi.advanceTimersByTimeAsync(50);
      expect(gateway.status).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
