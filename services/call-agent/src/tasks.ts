// The call agent's link to the backend task pipeline. It reuses Poorav's Postgres task
// store and sender lookup, so an utterance on a call becomes exactly what a text
// message becomes: a new task, a correction, an answer or a stop for the caller's Mac.

import type postgres from "postgres";
import { createSenderResolver, PostgresTaskStore } from "../../api/src/pg-store.js";
import type { InboundKind, TaskStatus } from "./conversation.js";

/** Who is calling, once resolved to an owner and their Mac. */
export interface Caller {
  ownerId: string;
  deviceId: string;
  /** Where results would be texted; a phone number for phone and FaceTime calls. */
  handle: string;
}

export interface TaskGateway {
  /** Routes one finished utterance. `utteranceId` makes a retry safe. */
  route(caller: Caller, text: string, utteranceId: string): Promise<{ taskId: string; kind: InboundKind }>;
  status(taskId: string): Promise<TaskStatus | null>;
  /** The caller's current active task, if any. */
  activeTask(caller: Caller): Promise<TaskStatus | null>;
}

export interface CallerDirectory {
  /** A phone number in E.164, as messaging identities store it. */
  byPhone(phone: string): Promise<Caller | null>;
  /** A signed-in app user calling from the Spectr app about one of their Macs. */
  byOwnerDevice(ownerId: string, deviceId: string): Promise<Caller | null>;
}

export class PostgresTaskGateway implements TaskGateway, CallerDirectory {
  private readonly store: PostgresTaskStore;
  private readonly resolveSendblue: (phone: string) => Promise<{ ownerId: string; deviceId: string } | null>;

  constructor(private readonly sql: postgres.Sql) {
    this.store = new PostgresTaskStore(sql);
    this.resolveSendblue = createSenderResolver(sql, "sendblue");
  }

  async route(caller: Caller, text: string, utteranceId: string) {
    const routed = await this.store.routeInbound({
      providerMessageId: utteranceId,
      ownerId: caller.ownerId,
      deviceId: caller.deviceId,
      text,
      replyProvider: "call",
      replyHandle: caller.handle,
      now: new Date(),
    });
    return { taskId: routed.taskId, kind: routed.kind };
  }

  async status(taskId: string): Promise<TaskStatus | null> {
    const task = await this.store.getTask(taskId);
    return task ? toStatus(task) : null;
  }

  async activeTask(caller: Caller): Promise<TaskStatus | null> {
    const task = await this.store.getActiveTaskForDevice(caller.deviceId, new Date());
    return task && task.ownerId === caller.ownerId ? toStatus(task) : null;
  }

  async byPhone(phone: string): Promise<Caller | null> {
    const found = await this.resolveSendblue(phone);
    return found ? { ...found, handle: phone } : null;
  }

  async byOwnerDevice(ownerId: string, deviceId: string): Promise<Caller | null> {
    const [row] = await this.sql`
      select id from public.devices
      where id = ${deviceId} and owner_id = ${ownerId} and kind = 'mac' and revoked_at is null
      limit 1
    `;
    return row ? { ownerId, deviceId, handle: `app:${ownerId}` } : null;
  }
}

function toStatus(task: {
  taskId: string;
  state: TaskStatus["state"];
  revision: number;
  question: string | null;
  summary: string | null;
}): TaskStatus {
  return {
    taskId: task.taskId,
    state: task.state,
    revision: task.revision,
    question: task.question,
    summary: task.summary,
  };
}

/** Normalizes a dialed or caller-ID number to E.164 (US default for 10 digits). */
export function toE164(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^(tel:|sip:)/iu, "").split("@")[0] ?? "";
  const digits = cleaned.replace(/[^\d+]/gu, "");
  if (/^\+[1-9]\d{6,14}$/u.test(digits)) return digits;
  const bare = digits.replace(/\D/gu, "");
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith("1")) return `+${bare}`;
  return null;
}
