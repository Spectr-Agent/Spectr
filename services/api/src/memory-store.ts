import { randomUUID } from "node:crypto";
import type { Command } from "./contracts.js";
import type {
  AgentTaskRecord,
  InboundKind,
  PendingInboundMessage,
  PersistAgentStepInput,
} from "./agent/types.js";
import { isStop, type TaskStore } from "./inbound.js";

interface InboundRow {
  providerMessageId: string;
  taskId: string;
  kind: InboundKind;
  text: string;
  consumedAt: string | null;
  replySentAt: string | null;
  createdAt: string;
}

const activeStates = new Set(["accepted", "running", "waitingForUser"]);
const terminalStates = new Set(["succeeded", "failed", "cancelled"]);

export class InMemoryTaskStore implements TaskStore {
  readonly tasks = new Map<string, AgentTaskRecord>();
  readonly commands = new Map<string, Command>();
  readonly deviceTokenHashes = new Map<string, string>();

  private readonly inboundMessages = new Map<string, InboundRow>();

  async routeInbound(input: {
    providerMessageId: string;
    ownerId: string;
    deviceId: string;
    text: string;
    replyProvider: "sendblue" | "chert";
    replyHandle: string;
    now: Date;
  }): Promise<{ taskId: string; kind: InboundKind; created: boolean }> {
    const existing = this.inboundMessages.get(input.providerMessageId);
    if (existing) {
      return {
        taskId: existing.taskId,
        kind: existing.kind,
        created: false,
      };
    }

    const now = input.now.toISOString();
    const staleBefore = input.now.getTime() - 15 * 60 * 1000;
    for (const task of this.tasks.values()) {
      if (
        task.deviceId === input.deviceId &&
        activeStates.has(task.state) &&
        Date.parse(task.updatedAt) < staleBefore
      ) {
        task.state = "failed";
        task.summary = "lost connection to ur mac";
        task.updatedAt = now;
      }
    }

    let task = [...this.tasks.values()].find(
      (candidate) =>
        candidate.deviceId === input.deviceId &&
        activeStates.has(candidate.state),
    );
    let kind: InboundKind;
    let consumedAt: string | null = null;

    if (!task) {
      kind = "task";
      task = {
        taskId: `tsk_${randomUUID()}`,
        ownerId: input.ownerId,
        deviceId: input.deviceId,
        state: "accepted",
        revision: 1,
        instruction: input.text,
        question: null,
        replyProvider: input.replyProvider,
        replyHandle: input.replyHandle,
        agentMessages: [],
        pendingToolResults: [],
        stepCount: 0,
        lastStepResponse: null,
        screenWidth: null,
        screenHeight: null,
        summary: null,
        finalScreenshot: null,
        finalScreenshotType: null,
        resultSentAt: null,
        updatedAt: now,
      };
      this.tasks.set(task.taskId, task);
      consumedAt = now;
    } else {
      task.replyProvider = input.replyProvider;
      task.replyHandle = input.replyHandle;
      if (isStop(input.text)) {
        kind = "stop";
        task.state = "cancelled";
        task.revision += 1;
        task.summary = "stopped";
        task.resultSentAt = now;
        task.updatedAt = now;
        consumedAt = now;
      } else if (task.state === "waitingForUser") {
        kind = "answer";
        task.state = "running";
        task.question = null;
        task.lastStepResponse = null;
        task.updatedAt = now;
      } else {
        kind = "correction";
        task.revision += 1;
        task.lastStepResponse = null;
        task.updatedAt = now;
      }
    }

    this.inboundMessages.set(input.providerMessageId, {
      providerMessageId: input.providerMessageId,
      taskId: task.taskId,
      kind,
      text: input.text,
      consumedAt,
      replySentAt: null,
      createdAt: now,
    });
    return { taskId: task.taskId, kind, created: true };
  }

  async isInboundReplySent(providerMessageId: string): Promise<boolean> {
    return this.inboundMessages.get(providerMessageId)?.replySentAt != null;
  }

  async markInboundReplySent(providerMessageId: string): Promise<void> {
    const row = this.inboundMessages.get(providerMessageId);
    if (row) {
      row.replySentAt ??= new Date().toISOString();
    }
  }

  async insertCommand(
    command: Command,
  ): Promise<{ command: Command; created: boolean }> {
    const existing = this.commands.get(command.commandId);
    if (existing) {
      return { command: existing, created: false };
    }

    this.commands.set(command.commandId, command);
    return { command, created: true };
  }

  async authenticateDevice(tokenHash: string): Promise<string | null> {
    return this.deviceTokenHashes.get(tokenHash) ?? null;
  }

  async getActiveTaskForDevice(
    deviceId: string,
    now: Date,
  ): Promise<AgentTaskRecord | null> {
    const staleBefore = now.getTime() - 15 * 60 * 1000;
    for (const task of this.tasks.values()) {
      if (
        task.deviceId === deviceId &&
        activeStates.has(task.state) &&
        Date.parse(task.updatedAt) < staleBefore
      ) {
        task.state = "failed";
        task.summary = "lost connection to ur mac";
        task.updatedAt = now.toISOString();
      }
    }
    return (
      [...this.tasks.values()].find(
        (task) => task.deviceId === deviceId && activeStates.has(task.state),
      ) ?? null
    );
  }

  async getTaskForDevice(
    taskId: string,
    deviceId: string,
  ): Promise<AgentTaskRecord | null> {
    const task = this.tasks.get(taskId);
    return task?.deviceId === deviceId ? task : null;
  }

  async getTask(taskId: string): Promise<AgentTaskRecord | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async getUnconsumedInboundMessages(
    taskId: string,
  ): Promise<PendingInboundMessage[]> {
    return [...this.inboundMessages.values()]
      .filter(
        (
          message,
        ): message is InboundRow & {
          kind: "correction" | "answer";
        } =>
          message.taskId === taskId &&
          message.consumedAt === null &&
          (message.kind === "correction" || message.kind === "answer"),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ providerMessageId, kind, text }) => ({
        providerMessageId,
        kind,
        text,
      }));
  }

  async persistAgentStep(input: PersistAgentStepInput): Promise<boolean> {
    const task = this.tasks.get(input.taskId);
    if (
      !task ||
      task.stepCount !== input.expectedStepCount ||
      task.revision !== input.expectedRevision ||
      !["accepted", "running"].includes(task.state)
    ) {
      return false;
    }

    task.state = input.state;
    task.question = input.question;
    task.agentMessages = input.agentMessages;
    task.pendingToolResults = input.pendingToolResults;
    task.stepCount = input.stepCount;
    task.lastStepResponse = input.lastStepResponse;
    task.screenWidth = input.screenWidth;
    task.screenHeight = input.screenHeight;
    task.summary = input.summary;
    task.finalScreenshot = input.finalScreenshot;
    task.finalScreenshotType = input.finalScreenshotType;
    task.updatedAt = input.now.toISOString();

    for (const providerMessageId of input.consumedInboundIds) {
      const inbound = this.inboundMessages.get(providerMessageId);
      if (inbound?.taskId === task.taskId && inbound.consumedAt === null) {
        inbound.consumedAt = input.now.toISOString();
      }
    }
    return true;
  }

  async claimResultNotification(
    taskId: string,
    now: Date,
  ): Promise<AgentTaskRecord | null> {
    const task = this.tasks.get(taskId);
    if (
      !task ||
      !terminalStates.has(task.state) ||
      task.resultSentAt !== null
    ) {
      return null;
    }
    task.resultSentAt = now.toISOString();
    return task;
  }

}
