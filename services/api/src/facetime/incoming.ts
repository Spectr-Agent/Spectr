// POST /api/chert/facetime — Chert's FaceTime "bring your own room" webhook.
//
// When someone FaceTimes Spectr's Chert line, Chert asks this route, with a five-second
// deadline, whether to answer and which LiveKit room to bridge into. We:
//   1. check the signature when a secret is configured,
//   2. confirm with Chert's API that this exact call exists on our line and is ringing
//      (a forged request must never get a token into a room next to someone's Mac),
//   3. resolve the line's owner and their Mac,
//   4. create the call room with the voice agent dispatched into it, and
//   5. answer with a bridge token for that room only.
// The agent shows the owner's Mac screen as its camera, so the caller sees the Mac.
//
// Owner: Jared.

import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import { z } from "zod";
import { verifyChertSignature } from "../chert/verify.js";
import { createSenderResolver } from "../pg-store.js";

type RouteEnvironment = Record<string, string | undefined>;
type MakeSql = (url: string) => postgres.Sql;

export const CHERT_FACETIME_API = "https://facetime.trychert.com/api";
export const BRIDGE_TTL_SECONDS = 2 * 60 * 60;
/** Chert's worker takes audio and video from the room's agent; it needs a distinct name. */
export const AGENT_IDENTITY_HINT = "spectr-agent";

const IncomingSchema = z.object({
  type: z.string(),
  data: z
    .object({
      call_id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u),
      line_id: z.string().min(1).max(100).optional(),
      media: z.object({ audio: z.boolean().optional(), video: z.boolean().optional() }).partial().optional(),
    })
    .passthrough(),
});

export interface FaceTimeDeps {
  /** Confirms with Chert that the call is real, on our line and still ringing. */
  confirmCall(callId: string, lineId: string | undefined): Promise<boolean>;
  /** The line owner and their Mac. */
  resolveOwner(): Promise<{ ownerId: string; deviceId: string } | null>;
  /** Creates the room with the agent dispatched, carrying the call's context. */
  dispatchAgent(room: string, metadata: Record<string, unknown>): Promise<void>;
  now(): Date;
}

const decline = () => Response.json({ action: "decline" }, { headers: { "cache-control": "no-store" } });

export function callRoomName(callId: string): string {
  return `spectr-ft-${callId.slice(0, 64)}`;
}

/** The token Chert's bridge uses to join exactly one call room. */
export async function bridgeToken(
  config: { apiKey: string; apiSecret: string },
  room: string,
  callId: string,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `chert-bridge-${callId.slice(0, 64)}`,
    name: "FaceTime",
    ttl: BRIDGE_TTL_SECONDS,
  });
  token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
  return token.toJwt();
}

export async function handleFaceTimeWebhook(
  request: Request,
  env: RouteEnvironment,
  deps: FaceTimeDeps,
): Promise<Response> {
  const raw = await request.text();
  if (env.CHERT_FACETIME_WEBHOOK_SECRET) {
    const headers = Object.fromEntries(request.headers.entries());
    if (!verifyChertSignature(raw, headers, env.CHERT_FACETIME_WEBHOOK_SECRET)) {
      // Names only, never values: lets us see how Chert labels FaceTime signatures.
      const names = Object.keys(headers).filter((name) => /sig|chert|webhook|timestamp/iu.test(name));
      console.error(`FaceTime webhook signature rejected; signature-like headers: ${names.join(", ") || "none"}`);
      return Response.json({ error: "invalid signature" }, { status: 401 });
    }
  }
  let parsed: z.infer<typeof IncomingSchema>;
  try {
    parsed = IncomingSchema.parse(JSON.parse(raw));
  } catch {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  // Other lifecycle events are acknowledged; only an incoming call needs a decision.
  if (parsed.type !== "call.incoming") return Response.json({ ok: true });

  const { call_id: callId, line_id: lineId, media } = parsed.data;
  if (env.CHERT_LINE_ID && lineId && lineId !== env.CHERT_LINE_ID) return decline();
  try {
    const [real, owner] = await Promise.all([deps.confirmCall(callId, lineId), deps.resolveOwner()]);
    if (!real || !owner) return decline();
    const room = callRoomName(callId);
    await deps.dispatchAgent(room, {
      chert_call: callId,
      media: { audio: true, video: media?.video !== false },
      spectr_owner: owner,
      spectr_poll_bridge: true,
    });
    const token = await bridgeToken(
      { apiKey: env.LIVEKIT_API_KEY!, apiSecret: env.LIVEKIT_API_SECRET! },
      room,
      callId,
    );
    return Response.json(
      {
        action: "accept",
        livekit_url: env.LIVEKIT_URL,
        participant_token: token,
        remote_participant_identity: AGENT_IDENTITY_HINT,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("facetime webhook failed", error instanceof Error ? error.message : "unknown");
    return decline();
  }
}

/** Reads a call from Chert. Fails closed: anything unexpected means "not confirmed". */
export function createChertCallChecker(
  config: { apiKey: string; projectId: string },
  fetchImpl: typeof fetch = fetch,
): FaceTimeDeps["confirmCall"] {
  return async (callId, lineId) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetchImpl(`${CHERT_FACETIME_API}/v1/calls/${encodeURIComponent(callId)}`, {
        headers: { authorization: `Bearer ${config.apiKey}`, "x-chert-project-id": config.projectId },
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const body = (await response.json()) as Record<string, unknown>;
      const call = (body.call ?? body.data ?? body) as Record<string, unknown>;
      const status = String(call.status ?? "");
      if (["ended", "failed", "rejected", "declined", "cancelled"].includes(status)) return false;
      const callLine = call.line_id ?? call.lineId;
      if (lineId && typeof callLine === "string" && callLine !== lineId) return false;
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createFaceTimeRoute(
  getEnv: () => RouteEnvironment,
  makeSql: MakeSql = (url) => postgres(url, { prepare: false, max: 1 }),
  overrides: Partial<FaceTimeDeps> = {},
): (request: Request) => Promise<Response> {
  let sql: postgres.Sql | undefined;
  return async (request) => {
    const env = getEnv();
    const required = [
      "POSTGRES_URL",
      "LIVEKIT_URL",
      "LIVEKIT_API_KEY",
      "LIVEKIT_API_SECRET",
      "CHERT_API_KEY",
      "CHERT_PROJECT_ID",
      "SPECTR_FACETIME_OWNER_PHONE",
    ];
    const missing = required.filter((name) => !env[name]);
    if (missing.length > 0) {
      console.error(`FaceTime webhook missing: ${missing.join(", ")}`);
      return decline();
    }
    const connection = (sql ??= makeSql(env.POSTGRES_URL!));
    const resolveSender = createSenderResolver(connection, "sendblue");
    const dispatcher = new AgentDispatchClient(
      env.LIVEKIT_URL!.replace(/^wss:/u, "https:"),
      env.LIVEKIT_API_KEY!,
      env.LIVEKIT_API_SECRET!,
    );
    const deps: FaceTimeDeps = {
      confirmCall:
        overrides.confirmCall ??
        createChertCallChecker({ apiKey: env.CHERT_API_KEY!, projectId: env.CHERT_PROJECT_ID! }),
      resolveOwner: overrides.resolveOwner ?? (() => resolveSender(env.SPECTR_FACETIME_OWNER_PHONE!)),
      dispatchAgent:
        overrides.dispatchAgent ??
        (async (room, metadata) => {
          await dispatcher.createDispatch(room, env.SPECTR_CALL_AGENT_NAME ?? "spectr-call", {
            metadata: JSON.stringify(metadata),
          });
        }),
      /* v8 ignore next */
      now: overrides.now ?? (() => new Date()),
    };
    return handleFaceTimeWebhook(request, env, deps);
  };
}

/** Random suffix helper for tests and manual runs. */
export const randomCallId = () => `test_${randomBytes(6).toString("hex")}`;
