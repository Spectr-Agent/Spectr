// LiveKit entry point: one job per call, whether it came from the LiveKit phone number,
// a FaceTime call through Chert, or the Spectr app.

import { AutoSubscribe, defineAgent, type JobContext, type JobProcess, voice } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import { ParticipantKind, RoomEvent, type RemoteParticipant } from "@livekit/rtc-node";
import postgres from "postgres";
import { createElevenLabsClient } from "../../api/src/voice/elevenlabs.js";
import { CallSession } from "./call.js";
import { loadEnv } from "./config.js";
import { NOT_LINKED } from "./conversation.js";
import { appCallerIdentity, bridgeReady, claimCaller, mediumOf, parseChertJob } from "./medium.js";
import { startScreenRelay, type ScreenRelay } from "./screen-relay.js";
import { createSpeaker } from "./speech.js";
import { PostgresTaskGateway, type Caller } from "./tasks.js";

let sql: postgres.Sql | undefined;

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
    // A Chert warm room exists before any caller: stay silent until one arrives. An app
    // call happens in the Mac's own room, so wait for the app user, never the Mac.
    const appIdentity = appCallerIdentity(ctx.job.metadata);
    const participant: RemoteParticipant = await ctx.waitForParticipant(appIdentity ?? undefined);
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
    if (claim.medium === "phone" || (claim.medium === "facetime" && claim.phone)) {
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
    let relay: ScreenRelay | undefined;

    const say = (text: string) => session?.say(text, { audio: speak(text), allowInterruptions: true, addToChatCtx: false });
    const hangUp = (afterMs = 2_500) => setTimeout(() => ctx.shutdown("caller finished"), afterMs);

    session = new voice.AgentSession({
      stt: env.SPECTR_CALL_STT_MODEL as never,
      vad: ctx.proc.userData.vad as silero.VAD,
    });

    const callId = chert?.callId ?? ctx.job.id;
    if (caller) {
      call = new CallSession(callId, mediumOf(claim), caller, gateway, { say, hangUp: () => hangUp() });
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
      if (claim.medium === "facetime" && chert?.video !== false) {
        relay = await startScreenRelay({
          config: { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET },
          deviceId: caller.deviceId,
          callId,
          callRoom: ctx.room,
        }).catch(() => undefined);
      }
      await call.begin({ justLinked });
    };

    if (claim.medium === "facetime") {
      // FaceTime drops a call that hears nothing within 10 s of bridge_ready, and
      // speaking before it is ready is lost: greet exactly once on the signal.
      let started = false;
      const check = () => {
        if (started || !bridgeReady(ctx.room.metadata)) return;
        started = true;
        ctx.room.off(RoomEvent.RoomMetadataChanged, check);
        void start();
      };
      ctx.room.on(RoomEvent.RoomMetadataChanged, check);
      check();
    } else {
      await start();
    }
  },
});
