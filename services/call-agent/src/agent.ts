// LiveKit entry point: one job per call, whether it came from the LiveKit phone number,
// a FaceTime call through Chert, or the Spectr app.

import { AutoSubscribe, defineAgent, inference, type JobContext, type JobProcess, voice } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import { ParticipantKind, RoomEvent, type AudioFrame, type RemoteParticipant } from "@livekit/rtc-node";
import postgres from "postgres";
import { createElevenLabsClient } from "../../api/src/voice/elevenlabs.js";
import { CallSession } from "./call.js";
import { loadEnv } from "./config.js";
import { NOT_LINKED, localHour } from "./conversation.js";
import {
  appCallerIdentity,
  bridgeReady,
  callBridgeReady,
  claimCaller,
  mediumOf,
  parseChertJob,
  webhookOwner,
} from "./medium.js";
import { startScreenRelay, type ScreenRelay } from "./screen-relay.js";
import { bufferSpeech, createSpeaker, replaySpeech } from "./speech.js";
import { PostgresTaskGateway, toE164, type Caller } from "./tasks.js";

let sql: postgres.Sql | undefined;
const APP_JOIN_TIMEOUT_MS = 45_000;
/** How long the greeting may keep FaceTime waiting for its audio once the bridge is ready. */
const GREETING_PRELOAD_WAIT_MS = 2_500;

/** The agent itself never answers: finished turns go to the task pipeline. */
class SpectrVoice extends voice.Agent {
  constructor(private readonly onTurn: (text: string) => Promise<void>) {
    super({ instructions: "Relay the caller's words to Spectr's task pipeline." });
  }

  override async onUserTurnCompleted(_chatCtx: unknown, message: { textContent?: string }): Promise<void> {
    const text = message.textContent ?? "";
    await this.onTurn(text);
    throw new voice.StopResponse();
  }
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    const env = loadEnv();
    sql ??= postgres(env.POSTGRES_URL, { prepare: false, max: 3 });
    const gateway = new PostgresTaskGateway(sql);
    const chert = parseChertJob(ctx.job.metadata);

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);

    // FaceTime: put the Mac's screen in the room before anyone calls, so the caller sees
    // it the moment the call connects instead of a gray connecting screen. A warm room
    // has no caller yet, but its owner is known from the line.
    let relay: ScreenRelay | undefined;
    if (chert && chert.video !== false) {
      const early = webhookOwner(ctx.job.metadata);
      const lineOwner = early
        ? await gateway.byOwnerDevice(early.ownerId, early.deviceId).catch(() => null)
        : env.SPECTR_FACETIME_OWNER_PHONE
          ? await gateway.byPhone(toE164(env.SPECTR_FACETIME_OWNER_PHONE) ?? "").catch(() => null)
          : null;
      if (lineOwner) {
        relay = await startScreenRelay({
          config: { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET },
          deviceId: lineOwner.deviceId,
          callId: chert.callId ?? ctx.job.id,
          callRoom: ctx.room,
        }).catch(() => undefined);
      }
    }
    // A Chert warm room exists before any caller: stay silent until one arrives. An app
    // call happens in the Mac's own room, so wait for the app user, never the Mac.
    const appIdentity = appCallerIdentity(ctx.job.metadata);
    let participant: RemoteParticipant;
    if (appIdentity) {
      // The app asked for this call; if it never joins (lost network), don't linger.
      const joined = await Promise.race([
        ctx.waitForParticipant(appIdentity),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), APP_JOIN_TIMEOUT_MS)),
      ]);
      if (!joined) {
        ctx.shutdown("app caller never joined");
        return;
      }
      participant = joined;
    } else {
      participant = await ctx.waitForParticipant();
    }
    const claim = claimCaller({
      jobMetadata: ctx.job.metadata,
      roomName: ctx.room.name ?? "",
      participant: {
        identity: participant.identity,
        isSip: participant.kind === ParticipantKind.SIP,
        attributes: participant.attributes ?? {},
      },
      facetimeOwnerPhone: env.SPECTR_FACETIME_OWNER_PHONE,
    });

    let caller: Caller | null = null;
    let justLinked = false;
    const owner = webhookOwner(ctx.job.metadata);
    if (claim.medium === "facetime" && owner) {
      // Answered by Spectr's FaceTime webhook, which already resolved the line's owner.
      caller = await gateway.byOwnerDevice(owner.ownerId, owner.deviceId).catch(() => null);
    } else if (claim.medium === "phone" || (claim.medium === "facetime" && claim.phone)) {
      caller = await gateway.byPhone(claim.phone as string).catch(() => null);
      if (!caller && claim.medium === "phone") {
        // The owner may have just asked to link this number in the app.
        caller = await gateway.claimPhoneLink(claim.phone).catch(() => null);
        justLinked = caller !== null;
      }
    } else if (claim.medium === "app") {
      caller = await gateway.byOwnerDevice(claim.ownerId, claim.deviceId).catch(() => null);
    }

    const speak = createSpeaker(createElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY }));
    let session: voice.AgentSession | undefined;
    let call: CallSession | undefined;

    // Lines whose audio was made ahead of time; each plays once, then is spoken live again.
    const preloaded = new Map<string, AudioFrame[]>();
    const audioFor = (text: string) => {
      const frames = preloaded.get(text);
      if (!frames) return speak(text);
      preloaded.delete(text);
      return replaySpeech(frames);
    };
    const say = (text: string) => session?.say(text, { audio: audioFor(text), allowInterruptions: true, addToChatCtx: false });
    const hangUp = (afterMs = 2_500) => setTimeout(() => ctx.shutdown("caller finished"), afterMs);

    session = new voice.AgentSession({
      stt: env.SPECTR_CALL_STT_MODEL as never,
      vad: ctx.proc.userData.vad as silero.VAD,
      // LiveKit's hosted end-of-turn model decides when the caller has finished, rather
      // than silence alone, so replies come sooner without cutting anyone off. It falls
      // back to the bundled local model if the cloud is unreachable.
      turnHandling: {
        turnDetection: new inference.TurnDetector({ version: "v1" }),
        endpointing: { minDelay: env.SPECTR_CALL_ENDPOINT_MIN_MS, maxDelay: env.SPECTR_CALL_ENDPOINT_MAX_MS },
      },
    });

    const callId = chert?.callId ?? ctx.job.id;
    if (caller) {
      call = new CallSession(callId, mediumOf(claim), caller, gateway, { say, hangUp: () => hangUp() });
    }
    const greetingOptions = {
      justLinked,
      name: claim.medium === "facetime" ? env.SPECTR_FACETIME_OWNER_NAME ?? null : null,
      hour: localHour(env.SPECTR_OWNER_TIMEZONE),
    };

    // FaceTime makes the agent wait for the bridge before it may speak. Use that wait to
    // choose the greeting and synthesize it, so it plays the moment the bridge is ready.
    let greetingReady: Promise<void> | undefined;
    if (call && claim.medium === "facetime") {
      const prepared = call;
      greetingReady = (async () => {
        const line = await prepared.prepareGreeting(greetingOptions);
        preloaded.set(line, await bufferSpeech(speak(line)));
      })().catch(() => undefined);
    }

    ctx.addShutdownCallback(async () => {
      call?.end();
      await relay?.stop();
      await session?.close();
    });

    await session.start({
      room: ctx.room,
      agent: new SpectrVoice(async (text) => {
        await call?.hear(text);
      }),
      record: false,
      inputOptions: {
        participantIdentity: participant.identity,
        audioEnabled: true,
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    } as never);

    const start = async () => {
      if (!caller || !call) {
        say(NOT_LINKED);
        hangUp(6_000);
        return;
      }
      if (claim.medium === "facetime" && chert?.video !== false && !relay) {
        relay = await startScreenRelay({
          config: { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET },
          deviceId: caller.deviceId,
          callId,
          callRoom: ctx.room,
        }).catch(() => undefined);
      }
      if (greetingReady) {
        // Preloaded audio is a head start, not a dependency: speak live if it isn't done.
        await Promise.race([greetingReady, new Promise((resolve) => setTimeout(resolve, GREETING_PRELOAD_WAIT_MS))]);
      }
      await call.begin(greetingOptions);
    };

    if (claim.medium === "facetime") {
      // FaceTime drops a call that hears nothing within 10 s of bridge_ready, and
      // speaking before it is ready is lost: greet exactly once on the signal.
      let started = false;
      const begin = () => {
        if (started) return;
        started = true;
        ctx.room.off(RoomEvent.RoomMetadataChanged, check);
        void start();
      };
      const check = () => {
        if (bridgeReady(ctx.room.metadata)) begin();
      };
      ctx.room.on(RoomEvent.RoomMetadataChanged, check);
      check();
      // Webhook-answered calls: nobody writes the room signal, so read the call from Chert.
      if (chert?.callId && env.CHERT_API_KEY && env.CHERT_PROJECT_ID && pollsBridge(ctx.job.metadata)) {
        void watchChertCall(chert.callId, env.CHERT_API_KEY, env.CHERT_PROJECT_ID, () => started, begin, () =>
          ctx.shutdown("FaceTime call ended"),
        );
      }
    } else {
      await start();
    }
  },
});

function pollsBridge(metadata: string | undefined | null): boolean {
  try {
    return (JSON.parse(metadata ?? "{}") as { spectr_poll_bridge?: unknown }).spectr_poll_bridge === true;
  } catch {
    return false;
  }
}

/** Reads the call from Chert every 500 ms until the bridge is ready (greet) or the call is over. */
async function watchChertCall(
  callId: string,
  apiKey: string,
  projectId: string,
  isStarted: () => boolean,
  onReady: () => void,
  onOver: () => void,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !isStarted()) {
    try {
      const response = await fetch(`https://facetime.trychert.com/api/v1/calls/${encodeURIComponent(callId)}`, {
        headers: { authorization: `Bearer ${apiKey}`, "x-chert-project-id": projectId },
      });
      if (response.ok) {
        const body = (await response.json()) as Record<string, unknown>;
        const state = callBridgeReady(body.call ?? body.data ?? body);
        if (state === "ready") return onReady();
        if (state === "over") return onOver();
      }
    } catch {
      // Keep trying until the deadline; a brief network error shouldn't drop the call.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!isStarted()) onOver();
}
