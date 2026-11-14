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
    async (_toNumber: string, _text: string) => {},
  ),
  resolveSender: InboundDeps["resolveSender"] = vi.fn(
    async (_fromNumber: string) => ({
      ownerId: "owner_demo_001",
      deviceId: "dev_demo_mac",
    }),
  ),
): InboundDeps {
  return { store, sendReply, resolveSender };
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
      `Spectr is on it. Task ${first.taskId}.`,
    );
  });

  it("retries the reply after a crash following task persistence", async () => {
    const store = new InMemoryTaskStore();
    const sendReply = vi
      .fn(async (_toNumber: string, _text: string) => {})
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
    expect(await store.isReplySent(retry.taskId)).toBe(true);
  });

  it("ignores unknown senders without persisting or replying", async () => {
    const store = new InMemoryTaskStore();
    const sendReply = vi.fn(async (_toNumber: string, _text: string) => {});
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
