// Shows the Mac's shared screen on a video call.
//
// The Mac publishes its shared window or display as a screen-share track in its own
// room (`spectr-mac-<deviceId>`). On a FaceTime call, Chert shows video only from the
// participant that speaks, so the agent subscribes to the Mac's screen (as a hidden
// participant) and republishes the frames as its own camera track in the call room.

import {
  LocalVideoTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackSource,
  VideoSource,
  VideoStream,
  type VideoFrame,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";

export const macRoomName = (deviceId: string) => `spectr-mac-${deviceId}`;
// The relay decodes and re-encodes video in the same container that runs the call's
// voice. At 30 fps it starved the voice (speech detection ran seconds behind), so the
// frame rate stays at 15.
export const RELAY_MAX_BITRATE = 5_000_000n;
export const RELAY_MAX_FPS = 15;
/** With no new frame for this long, the last one is sent again. */
export const RELAY_HOLD_MS = 600;

export interface LiveKitServerConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** A short-lived, subscribe-only, hidden token for watching one Mac's room. */
export async function relayToken(config: LiveKitServerConfig, deviceId: string, callId: string): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `spectr-relay-${callId}`,
    ttl: "2h",
  });
  token.addGrant({
    room: macRoomName(deviceId),
    roomJoin: true,
    canSubscribe: true,
    canPublish: false,
    canPublishData: false,
    hidden: true,
  });
  return token.toJwt();
}

/** How often an idle relay takes one fresh frame, so a new caller sees a recent screen. */
export const RELAY_IDLE_REFRESH_MS = 20_000;

export interface ScreenRelay {
  /**
   * Idle (no caller yet): keeps one recent frame on the call and stops receiving video,
   * because decoding and re-encoding the screen competes with the voice of every live
   * call in the same container. Active: relays every frame.
   */
  setActive(active: boolean): void;
  stop(): Promise<void>;
}

/**
 * Starts relaying. Resolves once connected to the Mac's room; frames flow when the
 * Mac is sharing. If the Mac isn't sharing, the call shows nothing from Spectr until
 * it starts.
 */
export async function startScreenRelay(options: {
  config: LiveKitServerConfig;
  deviceId: string;
  callId: string;
  callRoom: Room;
  onSharingChanged?: (sharing: boolean) => void;
  /** Start relaying every frame at once (a caller is present). Default true. */
  active?: boolean;
}): Promise<ScreenRelay> {
  let active = options.active ?? true;
  const screens = new Set<RemoteTrackPublication>();
  const subscribe = (on: boolean) => {
    for (const publication of screens) {
      try {
        publication.setSubscribed(on);
      } catch {
        // The Mac unpublished it; a new publication subscribes itself.
      }
    }
  };
  const refresh = setInterval(() => {
    if (!stopped && !active) subscribe(true);
  }, RELAY_IDLE_REFRESH_MS);
  const macRoom = new Room();
  let source: VideoSource | undefined;
  let track: LocalVideoTrack | undefined;
  let pumping: Promise<void> | undefined;
  let stopped = false;
  // A video call shows gray whenever it has no recent picture to decode: at the start,
  // after packet loss, and while the Mac's stream pauses or reconnects. Sending the last
  // frame again keeps a picture on the call and answers keyframe requests at once.
  let held: VideoFrame | undefined;
  let heldAt = 0;
  const hold = setInterval(() => {
    if (stopped || !held || !source || Date.now() - heldAt < RELAY_HOLD_MS) return;
    if (source.width !== held.width || source.height !== held.height) return;
    heldAt = Date.now();
    try {
      source.captureFrame(held);
    } catch {
      // The source closed between the check and the send.
    }
  }, RELAY_HOLD_MS);

  const publish = async (width: number, height: number) => {
    if (source && source.width === width && source.height === height) return;
    if (track) await options.callRoom.localParticipant?.unpublishTrack(track.sid ?? "").catch(() => {});
    await source?.close().catch(() => {});
    source = new VideoSource(width, height);
    track = LocalVideoTrack.createVideoTrack("spectr-mac-screen", source);
    await options.callRoom.localParticipant?.publishTrack(track, {
      source: TrackSource.SOURCE_CAMERA,
      simulcast: false,
      // Text on a screen needs bits, not frames: re-encode the Mac's screen sharply.
      videoEncoding: { maxBitrate: RELAY_MAX_BITRATE, maxFramerate: RELAY_MAX_FPS },
    } as never);
  };

  const pump = async (remote: RemoteTrack, publication: RemoteTrackPublication) => {
    const stream = new VideoStream(remote);
    options.onSharingChanged?.(true);
    try {
      for await (const event of stream) {
        if (stopped) break;
        await publish(event.frame.width, event.frame.height);
        source?.captureFrame(event.frame);
        held = event.frame;
        heldAt = Date.now();
        if (!active) {
          // One fresh frame is enough until a caller arrives.
          publication.setSubscribed(false);
          break;
        }
      }
    } finally {
      options.onSharingChanged?.(false);
    }
  };

  macRoom.on(
    RoomEvent.TrackSubscribed,
    (remote: RemoteTrack, publication: RemoteTrackPublication) => {
      if (remote.kind !== TrackKind.KIND_VIDEO || publication.source !== TrackSource.SOURCE_SCREENSHARE) return;
      screens.add(publication);
      pumping = pump(remote, publication).catch(() => {});
    },
  );

  await macRoom.connect(options.config.url, await relayToken(options.config, options.deviceId, options.callId), {
    autoSubscribe: true,
    dynacast: false,
  });

  return {
    setActive(next: boolean) {
      if (stopped || active === next) return;
      active = next;
      if (next) subscribe(true);
    },
    async stop() {
      stopped = true;
      clearInterval(hold);
      clearInterval(refresh);
      held = undefined;
      await macRoom.disconnect().catch(() => {});
      await pumping;
      if (track) await options.callRoom.localParticipant?.unpublishTrack(track.sid ?? "").catch(() => {});
      await source?.close().catch(() => {});
    },
  };
}
