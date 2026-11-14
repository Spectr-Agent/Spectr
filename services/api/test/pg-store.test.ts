import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { CommandSchema } from "../src/contracts.js";
import { handleChertWebhook } from "../src/chert/webhook.js";
import { PostgresTaskStore, createSenderResolver } from "../src/pg-store.js";
import type { InboundDeps } from "../src/inbound.js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = postgres(
  databaseUrl ?? "postgres://localhost/spectr_test",
  { prepare: false, max: 1 },
);
const ownerId = "00000000-0000-4000-8000-000000000001";
const deviceId = "dev_test_mac";
const fromNumber = "+15555550100";

function readFixture(): string {
  return readFileSync(
    new URL("./fixtures/chert-message-received.json", import.meta.url),
    "utf8",
  );
}

function signedHeader(rawBody: string, secret: string, timestamp: number): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe.skipIf(!databaseUrl)("PostgresTaskStore", () => {
  const db = sql;
  const store = new PostgresTaskStore(db);

  beforeEach(async () => {
    await db`
      truncate table
        public.results,
        public.events,
        public.commands,
        public.tasks,
        public.messaging_identities,
        public.devices,
        auth.users
      restart identity cascade
    `;
    await db`insert into auth.users (id) values (${ownerId})`;
    await db`
      insert into public.devices (id, owner_id, kind, name)
      values (${deviceId}, ${ownerId}, 'mac', 'Test Mac')
    `;
    await db`
      insert into public.messaging_identities (owner_id, provider, handle)
      values (${ownerId}, 'chert', ${fromNumber})
    `;
  });

  afterAll(async () => {
    await db.end();
  });

  it("deduplicates tasks by provider message ID", async () => {
    const input = {
      providerMessageId: "chert:msg:store_test_001",
      ownerId,
      deviceId,
      instruction: "open the demo deck",
    };

    const first = await store.createTaskFromMessage(input);
    const duplicate = await store.createTaskFromMessage(input);

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.task.taskId).toBe(first.task.taskId);
    expect(duplicate.task).toEqual(first.task);
  });

  it("tracks sent replies idempotently", async () => {
    const { task } = await store.createTaskFromMessage({
      providerMessageId: "chert:msg:reply_test_001",
      ownerId,
      deviceId,
      instruction: "open the demo deck",
    });

    expect(await store.isReplySent(task.taskId)).toBe(false);
    await store.markReplySent(task.taskId);
    const [firstMark] = await db`
      select reply_sent_at
      from public.tasks
      where id = ${task.taskId}
    `;
    await store.markReplySent(task.taskId);
    const [secondMark] = await db`
      select reply_sent_at
      from public.tasks
      where id = ${task.taskId}
    `;

    expect(await store.isReplySent(task.taskId)).toBe(true);
    expect(secondMark.reply_sent_at).toEqual(firstMark.reply_sent_at);
  });

  it("deduplicates commands and returns the task device ID", async () => {
    const { task } = await store.createTaskFromMessage({
      providerMessageId: "chert:msg:command_test_001",
      ownerId,
      deviceId,
      instruction: "open the demo deck",
    });
    const command = CommandSchema.parse({
      commandId: "cmd_store_test_001",
      taskId: task.taskId,
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

  it("resolves only active Chert identities with an active Mac", async () => {
    const resolveSender = createSenderResolver(db);

    expect(await resolveSender(fromNumber)).toEqual({
      ownerId,
      deviceId,
    });
    expect(await resolveSender("+15555550999")).toBeNull();

    await db`
      update public.devices
      set revoked_at = now()
      where id = ${deviceId}
    `;
    expect(await resolveSender(fromNumber)).toBeNull();

    await db`
      update public.devices
      set revoked_at = null
      where id = ${deviceId}
    `;
    await db`
      insert into public.messaging_identities (owner_id, provider, handle)
      values (${ownerId}, 'sendblue', '+15555550101')
    `;
    expect(await resolveSender("+15555550101")).toBeNull();
  });

  it("deduplicates a signed webhook delivery and persists the reply marker", async () => {
    const secret = "pg-store-test-webhook-secret";
    const rawBody = readFixture();
    const timestamp = Math.floor(Date.now() / 1000);
    const resolveSender = createSenderResolver(db);
    const sendReply = vi.fn(
      async (_toNumber: string, _text: string, _idempotencyKey: string) => {},
    );
    const inbound: InboundDeps = {
      store,
      resolveSender,
      sendReply,
    };
    const request = {
      rawBody,
      headers: {
        "X-Webhook-Signature": signedHeader(rawBody, secret, timestamp),
      },
    };
    const deps = { secret, inbound, nowSeconds: timestamp };

    const first = await handleChertWebhook(request, deps);
    const second = await handleChertWebhook(request, deps);
    const tasks = await db`
      select id, reply_sent_at
      from public.tasks
      where provider_message_id = 'chert:msg:demo_001'
    `;

    expect(first.body.outcome).toBe("created");
    expect(second.body.outcome).toBe("duplicate");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].reply_sent_at).toBeInstanceOf(Date);
    expect(sendReply).toHaveBeenCalledTimes(1);
  });
});
