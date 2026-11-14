import { randomUUID } from "node:crypto";
import type { Command, Task } from "./contracts.js";
import type { TaskStore } from "./inbound.js";

// In-memory store for tests and development only.
export class InMemoryTaskStore implements TaskStore {
  readonly tasks = new Map<string, Task>();
  readonly commands = new Map<string, Command>();

  private readonly taskIdsByProviderMessageId = new Map<string, string>();
  private readonly sentReplyTaskIds = new Set<string>();

  async createTaskFromMessage(input: {
    providerMessageId: string;
    ownerId: string;
    deviceId: string;
    instruction: string;
  }): Promise<{ task: Task; created: boolean }> {
    const existingTaskId = this.taskIdsByProviderMessageId.get(
      input.providerMessageId,
    );
    if (existingTaskId) {
      return { task: this.tasks.get(existingTaskId)!, created: false };
    }

    const now = new Date().toISOString();
    const task: Task = {
      taskId: `tsk_${randomUUID()}`,
      deviceId: input.deviceId,
      state: "accepted",
      revision: 1,
      instruction: input.instruction,
      lastObservedSlide: null,
      question: null,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.taskId, task);
    this.taskIdsByProviderMessageId.set(input.providerMessageId, task.taskId);
    return { task, created: true };
  }

  async isReplySent(taskId: string): Promise<boolean> {
    return this.sentReplyTaskIds.has(taskId);
  }

  async markReplySent(taskId: string): Promise<void> {
    this.sentReplyTaskIds.add(taskId);
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
}
