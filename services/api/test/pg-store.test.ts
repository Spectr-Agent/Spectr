import { readFileSync } from "node:fs";
import postgres from "postgres";
import {
  CommandSchema,
  MacStepResponseSchema,
} from "../src/contracts.js";
import { handleSendblueWebhook } from "../src/sendblue/webhook.js";
import { PostgresTaskStore, createSenderResolver } from "../src/pg-store.js";
import type { InboundDeps } from "../src/inbound.js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = postgres(databaseUrl ?? "postgres://localhost/spectr_test", {
  prepare: false,
  max: 4,
});
const ownerId = "00000000-0000-4000-8000-000000000001";
const deviceId = "dev_test_mac";
const fromNumber = "+15555550100";
const chertFromNumber = "+15555550102";
const store = new PostgresTaskStore(sql);

function readSendblueFixture(): string {
  return readFileSync(
    new URL("./fixtures/sendblue-message-received.json", import.meta.url),
    "utf8",
  );
}

function routeInput(
  providerMessageId: string,
  text = "open Instagram",
  now = new Date(),
) {
  return {
    providerMessageId,
    ownerId,
    deviceId,
    text,
    replyProvider: "sendblue" as const,
    replyHandle: fromNumber,
    now,
  };
}

describe.skipIf(!databaseUrl)("PostgresTaskStore", () => {
  beforeEach(async () => {
    await sql`
      truncate table
        public.inbound_messages,
        public.results,
        public.events,
        public.commands,
        public.tasks,
        public.messaging_identities,
        public.devices,
        auth.users
      restart identity cascade
    `;
    await sql`insert into auth.users (id) values (${ownerId})`;
    await sql`
      insert into public.devices (id, owner_id, kind, name)
      values (${deviceId}, ${ownerId}, 'mac', 'Test Mac')
    `;
    await sql`
      insert into public.messaging_identities (owner_id, provider, handle)
      values (${ownerId}, 'sendblue', ${fromNumber})
    `;
    await sql`
      insert into public.messaging_identities (owner_id, provider, handle)
      values (${ownerId}, 'chert', ${chertFromNumber})
    `;
  });

  afterAll(async () => {
    await sql.end();
  });

  it("deduplicates inbound provider IDs without reapplying task effects", async () => {
    const input = routeInput("sendblue:route:duplicate");
    const first = await store.routeInbound(input);
    const duplicate = await store.routeInbound({
      ...input,
      text: "stop",
    });
    const task = await store.getTask(first.taskId);

    expect(first).toEqual({
      taskId: first.taskId,
      kind: "task",
      created: true,
    });
    expect(duplicate).toEqual({
      taskId: first.taskId,
      kind: "task",
      created: false,
    });
    expect(task?.state).toBe("accepted");
    expect(task?.revision).toBe(1);
    expect(task?.instruction).toBe("open Instagram");
  });

  it("tracks reply delivery idempotently by inbound provider message ID", async () => {
    const providerMessageId = "sendblue:route:reply";
    const { taskId } = await store.routeInbound(
      routeInput(providerMessageId),
    );

    expect(await store.isInboundReplySent(providerMessageId)).toBe(false);
    await store.markInboundReplySent(providerMessageId);
    const [firstMark] = await sql`
      select reply_sent_at from public.inbound_messages
      where provider_message_id = ${providerMessageId}
    `;
    await store.markInboundReplySent(providerMessageId);
    const [secondMark] = await sql`
      select reply_sent_at from public.inbound_messages
      where provider_message_id = ${providerMessageId}
    `;

    expect(await store.isInboundReplySent(providerMessageId)).toBe(true);
    expect(secondMark.reply_sent_at).toEqual(firstMark.reply_sent_at);
    expect(await store.getTask(taskId)).not.toBeNull();
  });

  it("deduplicates commands and returns the task device ID", async () => {
    const { taskId } = await store.routeInbound(
      routeInput("sendblue:route:command"),
    );
    const command = CommandSchema.parse({
      commandId: "cmd_store_test_001",
      taskId,
      deviceId,
      revision: 1,
      action: { type: "openDemoDeck" },
      issuedAt: new Date().toISOString(),
    });

    const first = await store.insertCommand(command);
    const duplicate = await store.insertCommand({
      ...command,
      action: { type: "stop" },
    });

    expect(first.created).toBe(true);
    expect(first.command).toEqual(command);
    expect(duplicate.created).toBe(false);
    expect(duplicate.command).toEqual(command);
  });

  it("resolves Sendblue identities only for active Macs", async () => {
    const resolveSender = createSenderResolver(sql, "sendblue");

    expect(await resolveSender(fromNumber)).toEqual({ ownerId, deviceId });
    expect(await resolveSender(chertFromNumber)).toBeNull();
    expect(await resolveSender("+15555550999")).toBeNull();

    await sql`
      update public.devices
      set revoked_at = now()
      where id = ${deviceId}
    `;
    expect(await resolveSender(fromNumber)).toBeNull();
  });

  it("routes an answer, correction, and Stop with transactional state changes", async () => {
    const now = new Date();
    const first = await store.routeInbound(
      routeInput("sendblue:route:state-task", "open Instagram", now),
    );
    const correction = await store.routeInbound(
      routeInput("sendblue:route:correction", "Actually, open Safari", now),
    );
    await sql`
      update public.tasks
      set state = 'waitingForUser', question = 'Which account?'
      where id = ${first.taskId}
    `;
    const answer = await store.routeInbound(
      routeInput("sendblue:route:answer", "My personal account", now),
    );
    const stopped = await store.routeInbound(
      routeInput("sendblue:route:stop", "STOP.", now),
    );
    const task = await store.getTask(first.taskId);
    const inbound = await sql`
      select provider_message_id, kind, consumed_at
      from public.inbound_messages
      where task_id = ${first.taskId}
      order by created_at, provider_message_id
    `;

    expect(correction).toMatchObject({ taskId: first.taskId, kind: "correction" });
    expect(answer).toMatchObject({ taskId: first.taskId, kind: "answer" });
    expect(stopped).toMatchObject({ taskId: first.taskId, kind: "stop" });
    expect(task).toMatchObject({
      state: "cancelled",
      revision: 3,
      question: null,
      summary: "Stopped.",
    });
    expect(task?.resultSentAt).not.toBeNull();
    expect(inbound.find((row) => row.kind === "correction")?.consumed_at).toBeNull();
    expect(inbound.find((row) => row.kind === "answer")?.consumed_at).toBeNull();
    expect(inbound.find((row) => row.kind === "stop")?.consumed_at).toBeInstanceOf(Date);
  });

  it("expires a stale task before accepting a new task", async () => {
    const now = new Date("2026-11-14T12:00:00.000Z");
    const old = await store.routeInbound(
      routeInput("sendblue:route:stale-old", "old task", now),
    );
    const next = await store.routeInbound(
      routeInput(
        "sendblue:route:stale-new",
        "new task",
        new Date(now.getTime() + 16 * 60 * 1000),
      ),
    );

    expect(next.kind).toBe("task");
    expect(next.taskId).not.toBe(old.taskId);
    expect(await store.getTask(old.taskId)).toMatchObject({
      state: "failed",
      summary: "Lost connection to your Mac.",
    });
  });

  it("serializes concurrent inbound routing and preserves the active-task index", async () => {
    const now = new Date();
    const [first, second] = await Promise.all([
      store.routeInbound(routeInput("sendblue:route:parallel-a", "task A", now)),
      store.routeInbound(routeInput("sendblue:route:parallel-b", "task B", now)),
    ]);
    const active = await sql`
      select id
      from public.tasks
      where device_id = ${deviceId}
        and state in ('accepted', 'running', 'waitingForUser')
    `;
    const index = await sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'tasks_one_active_per_device'
    `;

    expect(first.taskId).toBe(second.taskId);
    expect([first.kind, second.kind].sort()).toEqual(["correction", "task"]);
    expect(active).toHaveLength(1);
    expect(index).toHaveLength(1);
  });

  it("rejects a second active task for the same device", async () => {
    await store.routeInbound(routeInput("sendblue:route:unique-active"));

    await expect(sql`
      insert into public.tasks (id, owner_id, device_id, state, instruction)
      values (
        'tsk_second_active',
        ${ownerId},
        ${deviceId},
        'accepted',
        'Second active task'
      )
    `).rejects.toThrow();
  });

  it("persists a step only when both the prior step and revision still match", async () => {
    const { taskId } = await store.routeInbound(
      routeInput("sendblue:route:conditional"),
    );
    const response = MacStepResponseSchema.parse({
      kind: "actions",
      taskId,
      step: 1,
      revision: 1,
      actions: [{ actionId: "tool-screenshot", action: { type: "screenshot" } }],
    });
    const input = {
      taskId,
      expectedStepCount: 0,
      expectedRevision: 1,
      stepCount: 1,
      state: "running" as const,
      question: null,
      agentMessages: [{ role: "assistant" as const, content: [] }],
      pendingToolResults: [],
      lastStepResponse: response,
      screenWidth: 1920,
      screenHeight: 1080,
      summary: null,
      finalScreenshot: null,
      finalScreenshotType: null,
      consumedInboundIds: [],
      now: new Date(),
    };

    expect(await store.persistAgentStep(input)).toBe(true);
    expect(await store.persistAgentStep(input)).toBe(false);
    await store.routeInbound(
      routeInput("sendblue:route:conditional-correction", "change task"),
    );
    expect(
      await store.persistAgentStep({
        ...input,
        expectedStepCount: 1,
        stepCount: 2,
      }),
    ).toBe(false);
    await store.routeInbound(
      routeInput("sendblue:route:conditional-stop", "Stop"),
    );
    expect(
      await store.persistAgentStep({
        ...input,
        expectedStepCount: 1,
        expectedRevision: 2,
        stepCount: 2,
      }),
    ).toBe(false);
    expect(await store.getTask(taskId)).toMatchObject({ state: "cancelled" });
  });

  it("deduplicates a signed Sendblue delivery and persists its reply marker", async () => {
    const rawBody = readSendblueFixture();
    const providerMessageId =
      "99DCC379-DD76-4712-BA65-11EFB33B8CD6";
    const secret = "pg-store-test-webhook-secret";
    const resolveSender = createSenderResolver(sql, "sendblue");
    const sendReply = vi.fn(
      async (
        _toNumber: string,
        _text: string,
        _idempotencyKey: string,
      ) => {},
    );
    const inbound: InboundDeps = {
      store,
      provider: "sendblue",
      resolveSender,
      sendReply,
    };
    const request = {
      rawBody,
      headers: { "sb-signing-secret": secret },
    };

    const first = await handleSendblueWebhook(request, { secret, inbound });
    const second = await handleSendblueWebhook(request, { secret, inbound });
    const tasks = await sql`
      select id
      from public.tasks
      where provider_message_id = ${providerMessageId}
    `;

    expect(first.body.outcome).toBe("created");
    expect(second.body.outcome).toBe("duplicate");
    expect(tasks).toHaveLength(1);
    expect(await store.isInboundReplySent(providerMessageId)).toBe(true);
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply).toHaveBeenCalledWith(
      fromNumber,
      "Working on it.",
      `reply-${providerMessageId}`,
    );
  });
});
