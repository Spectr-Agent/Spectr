import {
  InboundMessageSchema,
  type Command,
  type Task,
} from "./contracts.js";

export interface TaskStore {
  // Insert-or-return-existing keyed on providerMessageId (mirrors the DB unique constraint).
  createTaskFromMessage(input: {
    providerMessageId: string;
    ownerId: string;
    deviceId: string;
    instruction: string;
  }): Promise<{ task: Task; created: boolean }>;
  isReplySent(taskId: string): Promise<boolean>;
  markReplySent(taskId: string): Promise<void>;
  // Insert-or-return-existing keyed on commandId.
  insertCommand(command: Command): Promise<{ command: Command; created: boolean }>;
}

export interface InboundDeps {
  store: TaskStore;
  resolveSender(
    fromNumber: string,
  ): Promise<{ ownerId: string; deviceId: string } | null>;
  sendReply(
    toNumber: string,
    text: string,
    idempotencyKey: string,
  ): Promise<void>;
}

export type InboundOutcome =
  | { status: "created" | "duplicate"; taskId: string }
  | { status: "ignored"; reason: "unknownSender" };

export async function handleInboundMessage(
  raw: unknown,
  deps: InboundDeps,
): Promise<InboundOutcome> {
  const message = InboundMessageSchema.parse(raw);
  const sender = await deps.resolveSender(message.fromNumber);

  if (!sender) {
    return { status: "ignored", reason: "unknownSender" };
  }

  const { task, created } = await deps.store.createTaskFromMessage({
    providerMessageId: message.providerMessageId,
    ownerId: sender.ownerId,
    deviceId: sender.deviceId,
    instruction: message.text,
  });

  if (!(await deps.store.isReplySent(task.taskId))) {
    await deps.sendReply(
      message.fromNumber,
      `Spectr is on it. Task ${task.taskId}.`,
      `reply-${task.taskId}`,
    );
    await deps.store.markReplySent(task.taskId);
  }

  return {
    status: created ? "created" : "duplicate",
    taskId: task.taskId,
  };
}
