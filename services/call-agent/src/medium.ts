// Works out how a caller reached Spectr, and who they are, from what LiveKit tells the
// agent about the room and the participant. Pure, so every entry path is testable.

import { toE164 } from "./tasks.js";
import type { CallMedium } from "./conversation.js";

export interface ParticipantInfo {
  identity: string;
  /** True for a phone caller bridged in by LiveKit SIP. */
  isSip: boolean;
  attributes: Record<string, string>;
}

export interface ChertJob {
  warm: boolean;
  callId: string | null;
  /** False for FaceTime Audio; null when Chert didn't say (warm rooms). */
  video: boolean | null;
}

export function parseChertJob(metadata: string | undefined | null): ChertJob | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const warm = parsed.chert_warm === true;
    const callId = typeof parsed.chert_call === "string" ? parsed.chert_call : null;
    if (!warm && !callId) return null;
    const media = parsed.media as { video?: unknown } | undefined;
    return { warm, callId, video: typeof media?.video === "boolean" ? media.video : null };
  } catch {
    return null;
  }
}

/** True when chert dev has written the bridge_ready signal into the room metadata. */
export function bridgeReady(roomMetadata: string | undefined | null): boolean {
  try {
    return (JSON.parse(roomMetadata || "{}") as { chert_bridge_ready?: unknown }).chert_bridge_ready === true;
  } catch {
    return false;
  }
}

/** The identity the app caller joins with, from the dispatch the API created. */
export function appCallerIdentity(metadata: string | undefined | null): string | null {
  if (!metadata) return null;
  try {
    const value = (JSON.parse(metadata) as { spectr_app_identity?: unknown }).spectr_app_identity;
    return typeof value === "string" && /^user:[0-9a-f-]{36}$/iu.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** The owner and Mac the Vercel FaceTime webhook resolved for this call, if any. */
export function webhookOwner(metadata: string | undefined | null): { ownerId: string; deviceId: string } | null {
  if (!metadata) return null;
  try {
    const owner = (JSON.parse(metadata) as { spectr_owner?: { ownerId?: unknown; deviceId?: unknown } }).spectr_owner;
    if (typeof owner?.ownerId !== "string" || !/^[0-9a-f-]{36}$/iu.test(owner.ownerId)) return null;
    if (typeof owner.deviceId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(owner.deviceId)) return null;
    return { ownerId: owner.ownerId.toLowerCase(), deviceId: owner.deviceId };
  } catch {
    return null;
  }
}

/**
 * Whether a Chert call event list shows the bridge is up. In webhook mode nothing writes
 * `chert_bridge_ready` into the room, so the agent reads the call from Chert instead.
 */
export function callBridgeReady(call: unknown): "ready" | "waiting" | "over" {
  const record = (call ?? {}) as { status?: unknown; facetime_call_events?: unknown };
  const status = String(record.status ?? "");
  if (["ended", "failed", "rejected"].includes(status)) return "over";
  const events = Array.isArray(record.facetime_call_events) ? record.facetime_call_events : [];
  const ready = events.some((event) => {
    const item = event as { type?: unknown; event?: unknown; name?: unknown; source?: unknown };
    return [item.type, item.event, item.name].includes("bridge_ready") && (item.source === undefined || item.source === "worker");
  });
  return status === "active" && ready ? "ready" : "waiting";
}

export type CallerClaim =
  | { medium: "phone"; phone: string }
  | { medium: "facetime"; phone: string | null }
  | { medium: "app"; ownerId: string; deviceId: string }
  | { medium: "unknown" };

const MAC_ROOM = /^spectr-mac-([A-Za-z0-9_-]{1,64})$/u;
const APP_IDENTITY = /^user:([0-9a-f-]{36})$/iu;

/**
 * Identifies the caller. The claim is only a lookup key: the phone number or owner is
 * then checked against the database before anything is routed.
 */
export function claimCaller(input: {
  jobMetadata: string | undefined | null;
  roomName: string;
  participant: ParticipantInfo;
  facetimeOwnerPhone?: string;
}): CallerClaim {
  if (parseChertJob(input.jobMetadata) || input.participant.identity.startsWith("chert-bridge-")) {
    return { medium: "facetime", phone: toE164(input.facetimeOwnerPhone) };
  }
  if (input.participant.isSip) {
    const phone = toE164(input.participant.attributes["sip.phoneNumber"]);
    return phone ? { medium: "phone", phone } : { medium: "unknown" };
  }
  const room = MAC_ROOM.exec(input.roomName);
  const user = APP_IDENTITY.exec(input.participant.identity);
  if (room?.[1] && user?.[1]) return { medium: "app", ownerId: user[1].toLowerCase(), deviceId: room[1] };
  return { medium: "unknown" };
}

export function mediumOf(claim: CallerClaim): CallMedium {
  return claim.medium === "unknown" ? "phone" : claim.medium;
}
