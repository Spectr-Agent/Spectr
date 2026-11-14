import { readFileSync } from "node:fs";
import { CommandSchema } from "../src/contracts.js";
import {
  handleInboundMessage,
  type InboundDeps,
} from "../src/inbound.js";
import { InMemoryTaskStore } from "../src/memory-store.js";
import { describe, expect, it, vi } from "vitest";

function readFixture(fileName: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../contracts/${fileName}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function makeDeps(
  store: InMemoryTaskStore,
  sendReply: InboundDeps["sendReply"] = vi.fn(
    async (_toNumber: string, _text: string, _idempotencyKey: string) => {},
  ),
  resolveSender: InboundDeps["resolveSender"] = vi.fn(
    async (_fromNumber: string) => ({
      ownerId: "owner_demo_001",
      deviceId: "dev_demo_mac",
    }),
  ),
): InboundDeps {
  return { store, provider: "sendblue", sendReply, resolveSender };
}

describe("handleInboundMessage", () => {
  it("creates one task and sends one reply for replayed messages", async () => {
    const store = new InMemoryTaskStore();
    const deps = makeDeps(store);
    const message = readFixture("inbound-message.json");

    const first = await handleInboundMessage(message, deps);
    const second = await handleInboundMessage(message, deps);

    expect(store.tasks.size).toBe(1);
    expect(deps.sendReply).toHaveBeenCalledTimes(1);
    expect(first.status).toBe("created");
    expect(second.status).toBe("duplicate");
    if (first.status === "ignored" || second.status === "ignored") {
      throw new Error("Expected known senders to create a task");
    }
    expect(first.taskId).toBe(second.taskId);
    expect(deps.sendReply).toHaveBeenCalledWith(
      "+15555550100",
      "bet, on it",
      "reply-msg_demo_001",
    );
  });

  it("retries the reply after a crash following task persistence", async () => {
    const store = new InMemoryTaskStore();
    const sendReply = vi
      .fn(
        async (
          _toNumber: string,
          _text: string,
          _idempotencyKey: string,
        ) => {},
      )
      .mockRejectedValueOnce(new Error("send failed"))
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps(store, sendReply);
    const message = readFixture("inbound-message.json");

    await expect(handleInboundMessage(message, deps)).rejects.toThrow(
      "send failed",
    );
    expect(store.tasks.size).toBe(1);
    expect([...store.tasks.values()][0]?.taskId).toBeTruthy();

    const retry = await handleInboundMessage(message, deps);
    const replay = await handleInboundMessage(message, deps);

    expect(retry.status).toBe("duplicate");
    expect(replay.status).toBe("duplicate");
    if (retry.status === "ignored") {
      throw new Error("Expected the retry sender to be known");
    }
    expect(store.tasks.size).toBe(1);
    expect(sendReply).toHaveBeenCalledTimes(2);
    expect(await store.isInboundReplySent("msg_demo_001")).toBe(true);
  });

  it("ignores unknown senders without persisting or replying", async () => {
    const store = new InMemoryTaskStore();
    const sendReply = vi.fn(
      async (_toNumber: string, _text: string, _idempotencyKey: string) => {},
    );
    const resolveSender = vi.fn(async (_fromNumber: string) => null);
    const deps = makeDeps(store, sendReply, resolveSender);

    const outcome = await handleInboundMessage(
      readFixture("inbound-message.json"),
      deps,
    );

    expect(outcome).toEqual({ status: "ignored", reason: "unknownSender" });
    expect(store.tasks.size).toBe(0);
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("routes corrections, answers, and Stop with the matching reply text", async () => {
    const store = new InMemoryTaskStore();
    const deps = makeDeps(store);
    const sendReply = deps.sendReply;
    const base = {
      fromNumber: "+15555550100",
      receivedAt: "2026-11-13T12:00:00.000Z",
    };
    const task = await handleInboundMessage(
      {
        ...base,
        providerMessageId: "message-task",
        text: "Open Instagram",
      },
      deps,
    );
    if (task.status === "ignored") {
      throw new Error("Expected a task to be created");
    }

    const correction = await handleInboundMessage(
      {
        ...base,
        providerMessageId: "message-correction",
        text: "Actually, open Safari",
      },
      deps,
    );
    expect(correction).toMatchObject({ kind: "correction", taskId: task.taskId });
    expect(sendReply).toHaveBeenNthCalledWith(
      2,
      "+15555550100",
      "got u, switching it up",
      "reply-message-correction",
    );

    const record = store.tasks.get(task.taskId)!;
    record.state = "waitingForUser";
    record.question = "Which account?";
    const answer = await handleInboundMessage(
      {
        ...base,
        providerMessageId: "message-answer",
        text: "My personal account",
      },
      deps,
    );
    expect(answer).toMatchObject({ kind: "answer", taskId: task.taskId });
    expect(record.state).toBe("running");
    expect(record.question).toBeNull();
    expect(sendReply).toHaveBeenNthCalledWith(
      3,
      "+15555550100",
      "ok bet",
      "reply-message-answer",
    );

    const stopped = await handleInboundMessage(
      {
        ...base,
        providerMessageId: "message-stop",
        text: "  STOP. ",
      },
      deps,
    );
    expect(stopped).toMatchObject({ kind: "stop", taskId: task.taskId });
    expect(record.state).toBe("cancelled");
    expect(record.revision).toBe(3);
    expect(record.summary).toBe("stopped");
    expect(sendReply).toHaveBeenNthCalledWith(
      4,
      "+15555550100",
      "stopped",
      "reply-message-stop",
    );
  });

  it("deduplicates repeated corrections and Stop messages", async () => {
    const store = new InMemoryTaskStore();
    const deps = makeDeps(store);
    const task = await handleInboundMessage(
      {
        providerMessageId: "dedupe-task",
        fromNumber: "+15555550100",
        text: "Open Instagram",
        receivedAt: "2026-11-13T12:00:00.000Z",
      },
      deps,
    );
    if (task.status === "ignored") {
      throw new Error("Expected a task to be created");
    }

    const correctionMessage = {
      providerMessageId: "dedupe-correction",
      fromNumber: "+15555550100",
      text: "Actually, open Safari",
      receivedAt: "2026-11-13T12:00:01.000Z",
    };
    const correction = await handleInboundMessage(correctionMessage, deps);
    const duplicateCorrection = await handleInboundMessage(
      { ...correctionMessage, text: "Different correction" },
      deps,
    );
    const stopMessage = {
      providerMessageId: "dedupe-stop",
      fromNumber: "+15555550100",
      text: "Stop.",
      receivedAt: "2026-11-13T12:00:02.000Z",
    };
    const stopped = await handleInboundMessage(stopMessage, deps);
    const duplicateStop = await handleInboundMessage(stopMessage, deps);
    const record = store.tasks.get(task.taskId)!;

    expect(correction).toMatchObject({ kind: "correction", status: "created" });
    expect(duplicateCorrection).toMatchObject({
      kind: "correction",
      status: "duplicate",
    });
    expect(stopped).toMatchObject({ kind: "stop", status: "created" });
    expect(duplicateStop).toMatchObject({ kind: "stop", status: "duplicate" });
    expect(record.revision).toBe(3);
    expect(record.state).toBe("cancelled");
    expect(deps.sendReply).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid messages before creating a task", async () => {
    const store = new InMemoryTaskStore();
    const deps = makeDeps(store);
    const message = readFixture("inbound-message.json") as Record<
      string,
      unknown
    >;
    const { providerMessageId: _providerMessageId, ...invalidMessage } = message;

    await expect(handleInboundMessage(invalidMessage, deps)).rejects.toThrow();

    expect(store.tasks.size).toBe(0);
    expect(deps.sendReply).not.toHaveBeenCalled();
  });

  it("returns the original command when its ID is inserted twice", async () => {
    const store = new InMemoryTaskStore();
    const command = CommandSchema.parse(
      readFixture("command.openDemoDeck.json"),
    );

    const first = await store.insertCommand(command);
    const duplicate = await store.insertCommand(command);

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.command).toBe(command);
    expect(store.commands.size).toBe(1);
  });
});
