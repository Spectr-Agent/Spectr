// The iPhone app's API. Every route needs the user's Supabase access token and only ever
// reads or changes that user's own Macs, numbers and tasks.
//
//   GET    /api/app/home              account, Macs, numbers, active and recent tasks
//   GET    /api/app/task?id=          one task
//   GET    /api/app/session?id=       one chat: its tasks and conversation, oldest first
//   POST   /api/app/message           start a task, correct it or answer a question
//   POST   /api/app/stop              stop a task
//   POST   /api/app/live              LiveKit access to the Mac room: watch or call
//   POST   /api/app/pair              approve the pairing code a Mac is showing
//   POST   /api/app/phone             start linking a phone number (verified by calling)
//   DELETE /api/app/phone?phone=      unlink a number
//
// Messages go through the same `routeInbound` pipeline as iMessage and calls, so a task
// started anywhere can be corrected, answered or stopped from anywhere.
//
// Owner: Jared.

import { createHmac } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";
import type { TaskStore } from "../inbound.js";
import { appLiveGrant, createLiveKitRooms, type LiveKitRooms } from "../livekit/app-token.js";
import { createMacWaker, type WakeMac } from "../livekit/wake.js";
import { PostgresTaskStore } from "../pg-store.js";
import { createSupabaseUserVerifier, type AppUser, type VerifyUser } from "./auth.js";
import { appError, appJson, bearer, missingEnv, readJson } from "./http.js";
import { PostgresAppStore, type AppStore } from "./store.js";
import { chatMessages, macView, taskView, type AppMacView, type AppTaskView, type TaskRow } from "./views.js";

type RouteEnvironment = Record<string, string | undefined>;
type MakeSql = (url: string) => postgres.Sql;
type Handler = (request: Request) => Promise<Response>;

export interface AppRouteOverrides {
  verifyUser?: VerifyUser;
  makeAppStore?: (sql: postgres.Sql, sealSecret: string) => AppStore;
  makeTaskStore?: (sql: postgres.Sql) => TaskStore;
  rooms?: LiveKitRooms | null;
  wakeMac?: WakeMac;
  now?: () => Date;
}

export const DEFAULT_SPECTR_NUMBER = "+14705969455";
const ACTIVE = new Set(["accepted", "running", "waitingForUser"]);

const MessageSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/u),
  deviceId: z.string().min(1).max(64).optional(),
  /** Continue this chat; without it a new task starts a new chat. */
  sessionId: z.string().min(1).max(80).optional(),
});
const StopSchema = z.object({
  taskId: z.string().min(1).max(80),
  clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/u),
});
const LiveSchema = z.object({
  mode: z.enum(["watch", "call"]),
  deviceId: z.string().min(1).max(64).optional(),
});
const PairSchema = z.object({ code: z.string().min(4).max(16) });
const PhoneSchema = z.object({ phone: z.string().min(7).max(24) });

/** Normalizes a US or international number to E.164, or null. */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/gu, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export interface AppHome {
  user: { userId: string; email: string | null };
  macs: AppMacView[];
  phones: string[];
  pendingPhone: { phone: string; expiresAt: string } | null;
  spectrNumber: string;
  activeTask: AppTaskView | null;
  recentTasks: AppTaskView[];
}

export function createAppApi(
  getEnv: () => RouteEnvironment,
  makeSql: MakeSql = (url) => postgres(url, { prepare: false, max: 1 }),
  overrides: AppRouteOverrides = {},
) {
  let sql: postgres.Sql | undefined;
  let verifier: VerifyUser | undefined;
  let rooms: LiveKitRooms | null | undefined = overrides.rooms;
  let wakeMac: WakeMac | undefined = overrides.wakeMac;
  const now = () => overrides.now?.() ?? new Date();

  function context(env: RouteEnvironment) {
    const connection = (sql ??= makeSql(env.POSTGRES_URL!));
    const sealSecret = env.SPECTR_LINK_SECRET!;
    const appStore = overrides.makeAppStore?.(connection, sealSecret) ?? new PostgresAppStore(connection, sealSecret);
    const taskStore = overrides.makeTaskStore?.(connection) ?? new PostgresTaskStore(connection);
    if (rooms === undefined) {
      rooms =
        env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
          ? createLiveKitRooms({ url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET })
          : null;
    }
    wakeMac ??= createMacWaker({ url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET });
    const publicUrl = (env.SPECTR_PUBLIC_URL ?? "https://spectr-api.vercel.app").replace(/\/+$/u, "");
    const screenshotUrl = (taskId: string) =>
      `${publicUrl}/api/tasks/screenshot?task=${encodeURIComponent(taskId)}&sig=${createHmac("sha256", sealSecret).update(taskId).digest("hex")}`;
    return { appStore, taskStore, rooms, wakeMac, screenshotUrl };
  }

  /** Wraps a handler with configuration checks, authentication and error mapping. */
  function authed(
    handler: (request: Request, user: AppUser, env: RouteEnvironment, ctx: ReturnType<typeof context>) => Promise<Response>,
  ): Handler {
    return async (request) => {
      const env = getEnv();
      const misconfigured = missingEnv(env, ["POSTGRES_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SPECTR_LINK_SECRET"]);
      if (misconfigured) return misconfigured;
      const token = bearer(request);
      if (!token) return appError(401, "unauthorized", "Sign in to use Spectr.");
      verifier ??=
        overrides.verifyUser ??
        createSupabaseUserVerifier({ url: env.SUPABASE_URL!, publishableKey: env.SUPABASE_PUBLISHABLE_KEY! });
      let user: AppUser | null;
      try {
        user = await verifier(token);
      } catch {
        return appError(502, "upstreamError", "Couldn't check your sign-in. Try again.");
      }
      if (!user) return appError(401, "unauthorized", "Your sign-in expired. Sign in again.");
      try {
        return await handler(request, user, env, context(env));
      } catch (error) {
        console.error("app route failed", error);
        return appError(500, "upstreamError", "Something went wrong on Spectr's side. Try again.");
      }
    };
  }

  async function ownedMac(ctx: ReturnType<typeof context>, ownerId: string, deviceId?: string) {
    const macs = await ctx.appStore.macs(ownerId);
    return deviceId ? (macs.find((mac) => mac.id === deviceId) ?? null) : (macs[0] ?? null);
  }

  const view = (ctx: ReturnType<typeof context>, row: TaskRow) => taskView(row, ctx.screenshotUrl);

  const home = authed(async (_request, user, env, ctx) => {
    const at = now();
    const [macRows, phones, pendingPhone, tasks] = await Promise.all([
      ctx.appStore.macs(user.userId),
      ctx.appStore.phones(user.userId),
      ctx.appStore.pendingPhone(user.userId, at),
      ctx.appStore.recentTasks(user.userId, 50),
    ]);
    const macs = await Promise.all(
      macRows.map(async (row) => macView(row, ctx.rooms ? await ctx.rooms.macIsSharing(row.id) : null, at)),
    );
    const views = tasks.map((row) => view(ctx, row));
    const body: AppHome = {
      user: { userId: user.userId, email: user.email },
      macs,
      phones,
      pendingPhone: pendingPhone && !phones.includes(pendingPhone.phone) ? pendingPhone : null,
      spectrNumber: env.SPECTR_PHONE_NUMBER ?? DEFAULT_SPECTR_NUMBER,
      activeTask: views.find((task) => ACTIVE.has(task.state)) ?? null,
      recentTasks: views,
    };
    return appJson(body);
  });

  const task = authed(async (request, user, _env, ctx) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return appError(400, "invalidRequest", "A task id is required.");
    const row = await ctx.appStore.task(user.userId, id);
    return row ? appJson({ task: view(ctx, row) }) : appError(404, "notFound", "This task doesn't exist.");
  });

  const session = authed(async (request, user, _env, ctx) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return appError(400, "invalidRequest", "A chat id is required.");
    const { tasks, inbound } = await ctx.appStore.session(user.userId, id);
    if (tasks.length === 0) return appError(404, "notFound", "This chat doesn't exist.");
    return appJson({
      sessionId: id,
      tasks: tasks.map((row) => view(ctx, row)),
      messages: chatMessages(tasks, inbound, ctx.screenshotUrl),
    });
  });

  async function route(
    ctx: ReturnType<typeof context>,
    user: AppUser,
    input: { text: string; clientMessageId: string; deviceId: string; sessionId?: string },
  ) {
    const routed = await ctx.taskStore.routeInbound({
      providerMessageId: `app:${user.userId}:${input.clientMessageId}`,
      ownerId: user.userId,
      deviceId: input.deviceId,
      text: input.text,
      replyProvider: "app",
      replyHandle: user.userId,
      now: now(),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    const [row] = await Promise.all([ctx.appStore.task(user.userId, routed.taskId), ctx.wakeMac(input.deviceId)]);
    return appJson({ kind: routed.kind, created: routed.created, task: row ? view(ctx, row) : null });
  }

  const message = authed(async (request, user, _env, ctx) => {
    const parsed = MessageSchema.safeParse(await readJson(request));
    if (!parsed.success) return appError(400, "invalidRequest", "Say what you'd like Spectr to do.");
    const mac = await ownedMac(ctx, user.userId, parsed.data.deviceId);
    if (!mac) return appError(409, "noMac", "Pair a Mac first.");
    if (parsed.data.sessionId && (await ctx.appStore.session(user.userId, parsed.data.sessionId)).tasks.length === 0) {
      return appError(404, "notFound", "This chat doesn't exist.");
    }
    return route(ctx, user, { ...parsed.data, deviceId: mac.id });
  });

  const stop = authed(async (request, user, _env, ctx) => {
    const parsed = StopSchema.safeParse(await readJson(request));
    if (!parsed.success) return appError(400, "invalidRequest", "Which task should stop?");
    const row = await ctx.appStore.task(user.userId, parsed.data.taskId);
    if (!row) return appError(404, "notFound", "This task doesn't exist.");
    // Stopping a finished task is a no-op that still answers with its state.
    if (!ACTIVE.has(row.state)) return appJson({ kind: "stop", created: false, task: view(ctx, row) });
    return route(ctx, user, { text: "stop", clientMessageId: parsed.data.clientMessageId, deviceId: row.device_id });
  });

  const live = authed(async (request, user, env, ctx) => {
    const misconfigured = missingEnv(env, ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]);
    if (misconfigured) return misconfigured;
    const parsed = LiveSchema.safeParse(await readJson(request));
    if (!parsed.success) return appError(400, "invalidRequest", "Choose watch or call.");
    const mac = await ownedMac(ctx, user.userId, parsed.data.deviceId);
    if (!mac) return appError(409, "noMac", "Pair a Mac first.");
    const grant = await appLiveGrant(
      { url: env.LIVEKIT_URL!, apiKey: env.LIVEKIT_API_KEY!, apiSecret: env.LIVEKIT_API_SECRET! },
      { ownerId: user.userId, deviceId: mac.id, mode: parsed.data.mode },
      now(),
    );
    if (parsed.data.mode === "call") {
      if (!ctx.rooms) return appError(500, "misconfigured", "Calling isn't configured on the server.");
      await ctx.rooms.dispatchCallAgent(grant.room, env.SPECTR_CALL_AGENT_NAME ?? "spectr-call", grant.identity);
    }
    return appJson({ ...grant, deviceId: mac.id });
  });

  const pair = authed(async (request, user, _env, ctx) => {
    const parsed = PairSchema.safeParse(await readJson(request));
    if (!parsed.success) return appError(400, "invalidRequest", "Enter the code your Mac is showing.");
    const result = await ctx.appStore.approvePairing(user.userId, parsed.data.code, now());
    if (result.status === "notFound") {
      return appError(404, "notFound", "That code didn't match. Check the code on your Mac; codes last 10 minutes.");
    }
    return appJson({ deviceId: result.deviceId, name: result.name });
  });

  const phone = authed(async (request, user, env, ctx) => {
    if (request.method === "DELETE") {
      const number = toE164(new URL(request.url).searchParams.get("phone"));
      if (!number) return appError(400, "invalidRequest", "Which number should be removed?");
      await ctx.appStore.unlinkPhone(user.userId, number);
      return appJson({ status: "removed", phone: number });
    }
    const parsed = PhoneSchema.safeParse(await readJson(request));
    const number = toE164(parsed.success ? parsed.data.phone : null);
    if (!number) return appError(400, "invalidRequest", "Enter a phone number, like (470) 555-0100.");
    const result = await ctx.appStore.requestPhoneLink(user.userId, number, now());
    if (result.status === "taken") {
      return appError(409, "phoneTaken", "That number is already linked to another Spectr account.");
    }
    return appJson({
      status: result.status,
      phone: number,
      callNumber: env.SPECTR_PHONE_NUMBER ?? DEFAULT_SPECTR_NUMBER,
      expiresAt: result.status === "pending" ? result.expiresAt : null,
    });
  });

  return { home, task, session, message, stop, live, pair, phone };
}

/**
 * One function for every `/api/app/*` route (the Vercel Hobby plan caps a deployment at
 * twelve functions). vercel.json rewrites `/api/app/:route` here with `?route=`.
 */
export function createAppDispatcher(
  getEnv: () => RouteEnvironment,
  makeSql?: MakeSql,
  overrides?: AppRouteOverrides,
): Handler {
  const api = createAppApi(getEnv, makeSql, overrides);
  const table: Record<string, Handler | undefined> = {
    "GET home": api.home,
    "GET task": api.task,
    "GET session": api.session,
    "POST message": api.message,
    "POST stop": api.stop,
    "POST live": api.live,
    "POST pair": api.pair,
    "POST phone": api.phone,
    "DELETE phone": api.phone,
  };
  return async (request) => {
    const url = new URL(request.url);
    const route = url.searchParams.get("route") ?? url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const handler = table[`${request.method} ${route}`];
    return handler ? handler(request) : appError(404, "notFound", "Unknown route.");
  };
}
