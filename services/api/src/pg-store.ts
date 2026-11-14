import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  CommandSchema,
  TaskSchema,
  type Command,
  type Task,
} from "./contracts.js";
import type { InboundDeps, TaskStore } from "./inbound.js";

function toISOString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function taskFromRow(row: postgres.Row): Task {
  return TaskSchema.parse({
    taskId: row.id,
    deviceId: row.device_id,
    state: row.state,
    revision: row.revision,
    instruction: row.instruction,
    lastObservedSlide: row.last_observed_slide,
    question: row.question,
    createdAt: toISOString(row.created_at),
    updatedAt: toISOString(row.updated_at),
  });
}

function commandFromRow(row: postgres.Row): Command {
  const action =
    typeof row.action === "string" ? JSON.parse(row.action) : row.action;

  return CommandSchema.parse({
    commandId: row.id,
    taskId: row.task_id,
    deviceId: row.device_id,
    revision: row.revision,
    action,
    issuedAt: toISOString(row.issued_at),
  });
}

export class PostgresTaskStore implements TaskStore {
  constructor(private readonly sql: postgres.Sql) {}

  async createTaskFromMessage(input: {
    providerMessageId: string;
    ownerId: string;
    deviceId: string;
    instruction: string;
  }): Promise<{ task: Task; created: boolean }> {
    const inserted = await this.sql`
      insert into public.tasks (
        id,
        owner_id,
        device_id,
        state,
        instruction,
        provider_message_id
      )
      values (
        ${`tsk_${randomUUID()}`},
        ${input.ownerId},
        ${input.deviceId},
        'accepted',
        ${input.instruction},
        ${input.providerMessageId}
      )
      on conflict (provider_message_id) do nothing
      returning *
    `;

    const row =
      inserted[0] ??
      (
        await this.sql`
          select *
          from public.tasks
          where provider_message_id = ${input.providerMessageId}
        `
      )[0];
    if (!row) {
      throw new Error("Task insert did not return a row or find an existing task");
    }

    return { task: taskFromRow(row), created: inserted.length > 0 };
  }

  async isReplySent(taskId: string): Promise<boolean> {
    const [row] = await this.sql`
      select reply_sent_at
      from public.tasks
      where id = ${taskId}
    `;
    return row?.reply_sent_at != null;
  }

  async markReplySent(taskId: string): Promise<void> {
    await this.sql`
      update public.tasks
      set reply_sent_at = coalesce(reply_sent_at, now()),
          updated_at = now()
      where id = ${taskId}
    `;
  }

  async insertCommand(
    command: Command,
  ): Promise<{ command: Command; created: boolean }> {
    const inserted = await this.sql`
      insert into public.commands (
        id,
        task_id,
        revision,
        action,
        issued_at
      )
      values (
        ${command.commandId},
        ${command.taskId},
        ${command.revision},
        ${this.sql.json(command.action)},
        ${command.issuedAt}
      )
      on conflict (id) do nothing
      returning *
    `;
    const [row] = await this.sql`
      select c.id, c.task_id, c.revision, c.action, c.issued_at, t.device_id
      from public.commands c
      join public.tasks t on t.id = c.task_id
      where c.id = ${command.commandId}
    `;
    if (!row) {
      throw new Error("Command insert did not return a row or find an existing command");
    }

    return {
      command: commandFromRow(row),
      created: inserted.length > 0,
    };
  }
}

export function createSenderResolver(
  sql: postgres.Sql,
  provider = "chert",
): InboundDeps["resolveSender"] {
  return async (fromNumber) => {
    const [row] = await sql`
      select mi.owner_id, d.id as device_id
      from public.messaging_identities mi
      join public.devices d
        on d.owner_id = mi.owner_id
        and d.kind = 'mac'
        and d.revoked_at is null
      where mi.provider = ${provider}
        and mi.handle = ${fromNumber}
      order by d.last_seen_at desc nulls last, d.created_at desc
      limit 1
    `;
    return row
      ? { ownerId: row.owner_id, deviceId: row.device_id }
      : null;
  };
}
