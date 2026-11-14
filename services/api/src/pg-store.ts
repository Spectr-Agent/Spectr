import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  CommandSchema,
  MacStepResponseSchema,
  type Command,
} from "./contracts.js";
import type {
  AgentTaskRecord,
  InboundKind,
  PendingInboundMessage,
  PersistAgentStepInput,
} from "./agent/types.js";
import { isStop, type InboundDeps, type TaskStore } from "./inbound.js";

function toISOString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}

function agentTaskFromRow(row: postgres.Row): AgentTaskRecord {
  const agentMessages = parseJson(row.agent_messages);
  const pendingToolResults = parseJson(row.pending_tool_results);
  const lastStepResponse =
    row.last_step_response == null
      ? null
      : MacStepResponseSchema.parse(parseJson(row.last_step_response));

  return {
    taskId: row.id,
    ownerId: row.owner_id,
    deviceId: row.device_id,
    state: row.state,
    revision: row.revision,
    instruction: row.instruction,
    question: row.question,
    replyProvider: row.reply_provider,
    replyHandle: row.reply_handle,
    agentMessages: Array.isArray(agentMessages)
      ? agentMessages as AgentTaskRecord["agentMessages"]
      : [],
    pendingToolResults: Array.isArray(pendingToolResults)
      ? pendingToolResults
      : [],
    stepCount: row.step_count,
    lastStepResponse,
    screenWidth: row.screen_width,
    screenHeight: row.screen_height,
    summary: row.summary,
    finalScreenshot:
      row.final_screenshot == null
        ? null
        : Buffer.from(row.final_screenshot as Uint8Array),
    finalScreenshotType: row.final_screenshot_type,
    resultSentAt:
      row.result_sent_at == null ? null : toISOString(row.result_sent_at),
    updatedAt: toISOString(row.updated_at),
  };
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

  async routeInbound(input: {
    providerMessageId: string;
    ownerId: string;
    deviceId: string;
    text: string;
    replyProvider: "sendblue" | "chert";
    replyHandle: string;
    now: Date;
  }): Promise<{ taskId: string; kind: InboundKind; created: boolean }> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${input.providerMessageId}))`;
      const [existing] = await tx`
        select task_id, kind
        from public.inbound_messages
        where provider_message_id = ${input.providerMessageId}
      `;
      if (existing) {
        return {
          taskId: existing.task_id,
          kind: existing.kind as InboundKind,
          created: false,
        };
      }

      const [device] = await tx`
        select id
        from public.devices
        where id = ${input.deviceId}
          and owner_id = ${input.ownerId}
          and kind = 'mac'
          and revoked_at is null
        for update
      `;
      if (!device) {
        throw new Error("Inbound sender has no active paired Mac");
      }

      const staleBefore = new Date(input.now.getTime() - 15 * 60 * 1000);
      await tx`
        update public.tasks
        set state = 'failed',
            summary = 'Timed out waiting for the Mac.',
            updated_at = ${input.now}
        where device_id = ${input.deviceId}
          and state in ('accepted', 'running', 'waitingForUser')
          and updated_at < ${staleBefore}
      `;
      const [active] = await tx`
        select id, state
        from public.tasks
        where device_id = ${input.deviceId}
          and state in ('accepted', 'running', 'waitingForUser')
        for update
      `;

      let taskId: string;
      let kind: InboundKind;
      let consumedAt: Date | null = null;

      if (!active) {
        taskId = `tsk_${randomUUID()}`;
        kind = "task";
        consumedAt = input.now;
        await tx`
          insert into public.tasks (
            id,
            owner_id,
            device_id,
            state,
            instruction,
            provider_message_id,
            reply_provider,
            reply_handle,
            updated_at
          )
          values (
            ${taskId},
            ${input.ownerId},
            ${input.deviceId},
            'accepted',
            ${input.text},
            ${input.providerMessageId},
            ${input.replyProvider},
            ${input.replyHandle},
            ${input.now}
          )
        `;
      } else {
        taskId = active.id;
        if (isStop(input.text)) {
          kind = "stop";
          consumedAt = input.now;
          await tx`
            update public.tasks
            set state = 'cancelled',
                revision = revision + 1,
                summary = 'Stopped by the user.',
                result_sent_at = ${input.now},
                reply_provider = ${input.replyProvider},
                reply_handle = ${input.replyHandle},
                updated_at = ${input.now}
            where id = ${taskId}
          `;
        } else if (active.state === "waitingForUser") {
          kind = "answer";
          await tx`
          update public.tasks
          set state = 'running',
                question = null,
                last_step_response = null,
                reply_provider = ${input.replyProvider},
                reply_handle = ${input.replyHandle},
                updated_at = ${input.now}
            where id = ${taskId}
          `;
        } else {
          kind = "correction";
          await tx`
          update public.tasks
          set revision = revision + 1,
                last_step_response = null,
                reply_provider = ${input.replyProvider},
                reply_handle = ${input.replyHandle},
                updated_at = ${input.now}
            where id = ${taskId}
          `;
        }
      }

      await tx`
        insert into public.inbound_messages (
          provider_message_id,
          task_id,
          kind,
          text,
          consumed_at,
          created_at
        )
        values (
          ${input.providerMessageId},
          ${taskId},
          ${kind},
          ${input.text},
          ${consumedAt},
          ${input.now}
        )
      `;
      return { taskId, kind, created: true };
    });
  }

  async isInboundReplySent(providerMessageId: string): Promise<boolean> {
    const [row] = await this.sql`
      select reply_sent_at
      from public.inbound_messages
      where provider_message_id = ${providerMessageId}
    `;
    return row?.reply_sent_at != null;
  }

  async markInboundReplySent(providerMessageId: string): Promise<void> {
    await this.sql`
      update public.inbound_messages
      set reply_sent_at = coalesce(reply_sent_at, now())
      where provider_message_id = ${providerMessageId}
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

  async authenticateDevice(tokenHash: string): Promise<string | null> {
    const [row] = await this.sql`
      update public.devices
      set last_seen_at = now()
      where token_hash = ${tokenHash}
        and kind = 'mac'
        and revoked_at is null
      returning id
    `;
    return row?.id ?? null;
  }

  async getActiveTaskForDevice(
    deviceId: string,
    now: Date,
  ): Promise<AgentTaskRecord | null> {
    return this.sql.begin(async (tx) => {
      const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
      await tx`
        update public.tasks
        set state = 'failed',
            summary = 'Timed out waiting for the Mac.',
            updated_at = ${now}
        where device_id = ${deviceId}
          and state in ('accepted', 'running', 'waitingForUser')
          and updated_at < ${staleBefore}
      `;
      const [row] = await tx`
        select *
        from public.tasks
        where device_id = ${deviceId}
          and state in ('accepted', 'running', 'waitingForUser')
        order by updated_at desc
        limit 1
      `;
      return row ? agentTaskFromRow(row) : null;
    });
  }

  async getTaskForDevice(
    taskId: string,
    deviceId: string,
  ): Promise<AgentTaskRecord | null> {
    const [row] = await this.sql`
      select *
      from public.tasks
      where id = ${taskId}
        and device_id = ${deviceId}
    `;
    return row ? agentTaskFromRow(row) : null;
  }

  async getTask(taskId: string): Promise<AgentTaskRecord | null> {
    const [row] = await this.sql`
      select *
      from public.tasks
      where id = ${taskId}
    `;
    return row ? agentTaskFromRow(row) : null;
  }

  async getUnconsumedInboundMessages(
    taskId: string,
  ): Promise<PendingInboundMessage[]> {
    const rows = await this.sql`
      select provider_message_id, kind, text
      from public.inbound_messages
      where task_id = ${taskId}
        and consumed_at is null
        and kind in ('correction', 'answer')
      order by created_at
    `;
    return rows.map((row) => ({
      providerMessageId: row.provider_message_id,
      kind: row.kind as PendingInboundMessage["kind"],
      text: row.text,
    }));
  }

  async persistAgentStep(input: PersistAgentStepInput): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const updated = await tx`
            update public.tasks
        set agent_messages = ${this.sql.json(
          input.agentMessages as unknown as Parameters<
            typeof this.sql.json
          >[0],
        )},
            pending_tool_results = ${this.sql.json(
          input.pendingToolResults as unknown as Parameters<
            typeof this.sql.json
          >[0],
        )},
            step_count = ${input.stepCount},
            last_step_response = ${this.sql.json(input.lastStepResponse)},
            state = ${input.state},
            question = ${input.question},
            screen_width = ${input.screenWidth},
            screen_height = ${input.screenHeight},
            summary = ${input.summary},
            final_screenshot = ${input.finalScreenshot},
            final_screenshot_type = ${input.finalScreenshotType},
            updated_at = ${input.now}
        where id = ${input.taskId}
          and step_count = ${input.expectedStepCount}
          and revision = ${input.expectedRevision}
          and state in ('accepted', 'running')
        returning id
      `;
      if (updated.length === 0) {
        return false;
      }
      for (const providerMessageId of input.consumedInboundIds) {
        await tx`
          update public.inbound_messages
          set consumed_at = ${input.now}
          where provider_message_id = ${providerMessageId}
            and task_id = ${input.taskId}
            and consumed_at is null
        `;
      }
      return true;
    });
  }

  async claimResultNotification(
    taskId: string,
    now: Date,
  ): Promise<AgentTaskRecord | null> {
    const [row] = await this.sql`
      update public.tasks
      set result_sent_at = ${now}
      where id = ${taskId}
        and result_sent_at is null
        and state in ('succeeded', 'failed', 'cancelled')
      returning *
    `;
    return row ? agentTaskFromRow(row) : null;
  }
}

export function createSenderResolver(
  sql: postgres.Sql,
  provider: string,
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
