import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { PostgresTaskGateway, type Caller } from "../../../../services/call-agent/src/tasks.js";
import type { TaskStore } from "../../../../services/api/src/inbound.js";

const caller: Caller = { ownerId: "o1", deviceId: "d1", handle: "+1" };

function gateway(store: Partial<TaskStore> = {}, resolver: (phone: string) => Promise<unknown> = async () => null) {
  const gw = new PostgresTaskGateway((() => Promise.resolve([])) as unknown as postgres.Sql);
  const inner = gw as unknown as { store: TaskStore; resolveSendblue: typeof resolver };
  inner.store = {
    routeInbound: async () => ({ taskId: "t1", kind: "task" as const, created: true }),
    getTask: async () => null,
    getActiveTaskForDevice: async () => null,
    ...store,
  } as TaskStore;
  inner.resolveSendblue = resolver;
  return gw;
}

const statusRow = { taskId: "t1", ownerId: "o1", deviceId: "d1", state: "running" as const, revision: 2, question: null, summary: null };

describe("PostgresTaskGateway", () => {
  it("routes an utterance through the task store", async () => {
    let seen: unknown;
    const gw = gateway({
      routeInbound: async (input) => {
        seen = input;
        return { taskId: "t1", kind: "correction" as const, created: true };
      },
    });
    expect(await gw.route(caller, "add eggs", "call:c1:1")).toEqual({ taskId: "t1", kind: "correction" });
    expect(seen).toMatchObject({
      providerMessageId: "call:c1:1",
      ownerId: "o1",
      deviceId: "d1",
      text: "add eggs",
      replyProvider: "call",
      replyHandle: "+1",
    });
  });

  it("maps a stored task to a TaskStatus", async () => {
    const gw = gateway({ getTask: async () => statusRow as never });
    expect(await gw.status("t1")).toEqual({
      taskId: "t1",
      state: "running",
      revision: 2,
      question: null,
      summary: null,
    });
    expect(await gateway().status("t9")).toBeNull();
  });

  it("returns the active task only for the caller's owner", async () => {
    const own = gateway({ getActiveTaskForDevice: async () => statusRow as never });
    expect(await own.activeTask(caller)).toMatchObject({ taskId: "t1" });
    const other = gateway({ getActiveTaskForDevice: async () => ({ ...statusRow, ownerId: "o2" }) as never });
    expect(await other.activeTask(caller)).toBeNull();
  });

  it("resolves callers by phone through the sendblue directory", async () => {
    const gw = gateway({}, async () => ({ ownerId: "o1", deviceId: "d1" }));
    expect(await gw.byPhone("+1")).toEqual({ ownerId: "o1", deviceId: "d1", handle: "+1" });
    expect(await gateway().byPhone("+9")).toBeNull();
  });

  it("resolves app callers by owner and device", async () => {
    const sql = ((strings: TemplateStringsArray) => {
      void strings;
      return Promise.resolve([{ id: "d1" }]);
    }) as unknown as postgres.Sql;
    const gw = new PostgresTaskGateway(sql);
    expect(await gw.byOwnerDevice("o1", "d1")).toEqual({ ownerId: "o1", deviceId: "d1", handle: "app:o1" });

    const none = new PostgresTaskGateway((() => Promise.resolve([])) as unknown as postgres.Sql);
    expect(await none.byOwnerDevice("o1", "d9")).toBeNull();
  });

  it("claims a pending phone link inside one transaction", async () => {
    const queries: string[] = [];
    const tx = ((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      queries.push(text);
      if (/phone_link_requests\s*$/mu.test(text.trim().replace(/\s+/gu, " ")) || /select owner_id/mu.test(text)) {
        return Promise.resolve([{ owner_id: "o1" }]);
      }
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;
    tx.begin = (cb: (t: postgres.Sql) => unknown) => Promise.resolve(cb(tx)) as never;
    const gw = new PostgresTaskGateway(tx);
    (gw as unknown as { resolveSendblue: (p: string) => Promise<unknown> }).resolveSendblue =
      async () => ({ ownerId: "o1", deviceId: "d1" });
    expect(await gw.claimPhoneLink("+1")).toEqual({ ownerId: "o1", deviceId: "d1", handle: "+1" });
    expect(queries.some((q) => q.includes("delete from public.phone_link_requests"))).toBe(true);

    const empty = (() => Promise.resolve([])) as unknown as postgres.Sql;
    empty.begin = (cb: (t: postgres.Sql) => unknown) => Promise.resolve(cb(empty)) as never;
    expect(await new PostgresTaskGateway(empty).claimPhoneLink("+1")).toBeNull();
  });
});
