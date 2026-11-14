import { InboundMessageSchema, type Command } from "./contracts.js";
import type {
  AgentTaskRecord,
  InboundKind,
  PendingInboundMessage,
  PersistAgentStepInput,
} from "./agent/types.js";

export interface TaskStore {
  routeInbound(input: {
    providerMessageId: string;
    ownerId: string;
    deviceId: string;
    text: string;
    replyProvider: "sendblue" | "chert";
    replyHandle: string;
    now: Date;
  }): Promise<{ taskId: string; kind: InboundKind; created: boolean }>;
  isInboundReplySent(providerMessageId: string): Promise<boolean>;
  markInboundReplySent(providerMessageId: string): Promise<void>;
  // Insert-or-return-existing keyed on commandId.
  insertCommand(command: Command): Promise<{ command: Command; created: boolean }>;
  authenticateDevice(tokenHash: string): Promise<string | null>;
  getActiveTaskForDevice(
    deviceId: string,
    now: Date,
  ): Promise<AgentTaskRecord | null>;
  getTaskForDevice(
    taskId: string,
    deviceId: string,
  ): Promise<AgentTaskRecord | null>;
  getTask(taskId: string): Promise<AgentTaskRecord | null>;
  getUnconsumedInboundMessages(
    taskId: string,
  ): Promise<PendingInboundMessage[]>;
  persistAgentStep(input: PersistAgentStepInput): Promise<boolean>;
  claimResultNotification(taskId: string, now: Date): Promise<AgentTaskRecord | null>;
}

export interface InboundDeps {
  store: TaskStore;
  provider: "sendblue" | "chert";
  resolveSender(
    fromNumber: string,
  ): Promise<{ ownerId: string; deviceId: string } | null>;
  sendReply(
    toNumber: string,
    text: string,
    idempotencyKey: string,
    mediaUrl?: string,
  ): Promise<void>;
}

export type InboundOutcome =
  | {
      status: "created" | "duplicate";
      taskId: string;
      kind: InboundKind;
    }
  | { status: "ignored"; reason: "unknownSender" };

export function isStop(text: string): boolean {
  return [
    "stop",
    "cancel",
    "abort",
    "stop it",
    "nevermind",
    "never mind",
  ].includes(text.trim().toLowerCase().replace(/[.!]+$/u, ""));
}

function replyForInbound(kind: InboundKind): string {
  switch (kind) {
    case "task":
      return "bet, on it";
    case "correction":
      return "got u, switching it up";
    case "answer":
      return "ok bet";
    case "stop":
      return "stopped";
  }
}

export async function handleInboundMessage(
  raw: unknown,
  deps: InboundDeps,
): Promise<InboundOutcome> {
  const message = InboundMessageSchema.parse(raw);
  const sender = await deps.resolveSender(message.fromNumber);

  if (!sender) {
    return { status: "ignored", reason: "unknownSender" };
  }

  const routed = await deps.store.routeInbound({
    providerMessageId: message.providerMessageId,
    ownerId: sender.ownerId,
    deviceId: sender.deviceId,
    text: message.text,
    replyProvider: deps.provider,
    replyHandle: message.fromNumber,
    now: new Date(),
  });

  if (!(await deps.store.isInboundReplySent(message.providerMessageId))) {
    await deps.sendReply(
      message.fromNumber,
      replyForInbound(routed.kind),
      `reply-${message.providerMessageId}`,
    );
    await deps.store.markInboundReplySent(message.providerMessageId);
  }

  return {
    status: routed.created ? "created" : "duplicate",
    taskId: routed.taskId,
    kind: routed.kind,
  };
}
