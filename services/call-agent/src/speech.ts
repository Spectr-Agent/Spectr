// Spoken replies for live calls, using the same ElevenLabs client and pinned voice as
// the app's speech endpoint (services/api/src/voice). Calls need raw PCM so frames can
// be played as they arrive, so this asks the client for `pcm_24000`.

import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { AudioFrame } from "@livekit/rtc-node";
import { voiceConfig } from "../../api/src/voice/config.js";
import type { TtsClient } from "../../api/src/voice/elevenlabs.js";

export const SAMPLE_RATE = 24_000;
/** 20 ms of mono audio at 24 kHz. */
export const SAMPLES_PER_FRAME = 480;

/**
 * Turns a stream of little-endian 16-bit PCM bytes (arbitrary chunk boundaries) into
 * fixed 20 ms frames. A final partial frame is padded with silence.
 */
export async function* pcmFrames(
  chunks: AsyncIterable<Uint8Array>,
  sampleRate = SAMPLE_RATE,
  samplesPerFrame = SAMPLES_PER_FRAME,
): AsyncGenerator<AudioFrame> {
  const frameBytes = samplesPerFrame * 2;
  let pending = new Uint8Array(0);
  for await (const chunk of chunks) {
    const merged = new Uint8Array(pending.length + chunk.length);
    merged.set(pending);
    merged.set(chunk, pending.length);
    let offset = 0;
    while (merged.length - offset >= frameBytes) {
      yield toFrame(merged.subarray(offset, offset + frameBytes), sampleRate, samplesPerFrame);
      offset += frameBytes;
    }
    pending = merged.slice(offset);
  }
  if (pending.length >= 2) {
    const padded = new Uint8Array(frameBytes);
    padded.set(pending.subarray(0, pending.length - (pending.length % 2)));
    yield toFrame(padded, sampleRate, samplesPerFrame);
  }
}

function toFrame(bytes: Uint8Array, sampleRate: number, samplesPerFrame: number): AudioFrame {
  const samples = new Int16Array(samplesPerFrame);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < samplesPerFrame; i += 1) samples[i] = view.getInt16(i * 2, true);
  return new AudioFrame(samples, sampleRate, 1, samplesPerFrame);
}

async function* iterate(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Speaks text in Spectr's pinned voice as a stream of audio frames. */
export function createSpeaker(tts: TtsClient, timeoutMs = 10_000) {
  // The agents framework types `say({ audio })` with Node's stream/web ReadableStream.
  return function speak(text: string, signal?: AbortSignal): NodeReadableStream<AudioFrame> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const clipped = text.slice(0, voiceConfig.maxTextChars);
    let frames: AsyncGenerator<AudioFrame> | undefined;
    return new NodeReadableStream<AudioFrame>({
      async pull(controller) {
        try {
          frames ??= pcmFrames(iterate(await tts.stream(clipped, { signal: abort.signal, outputFormat: "pcm_24000" })));
          const next = await frames.next();
          if (next.done) {
            clearTimeout(timer);
            controller.close();
          } else {
            controller.enqueue(next.value);
          }
        } catch (error) {
          clearTimeout(timer);
          controller.error(error);
        }
      },
      cancel() {
        clearTimeout(timer);
        abort.abort();
      },
    });
  };
}

/**
 * Pulls a whole line of speech into memory. Used for the greeting, which is made while
 * the call is still connecting so it plays the instant FaceTime is ready to hear it.
 */
export async function bufferSpeech(stream: NodeReadableStream<AudioFrame>): Promise<AudioFrame[]> {
  const frames: AudioFrame[] = [];
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return frames;
      frames.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

/** Plays back frames captured by `bufferSpeech` as the session expects them. */
export function replaySpeech(frames: readonly AudioFrame[]): NodeReadableStream<AudioFrame> {
  let index = 0;
  return new NodeReadableStream<AudioFrame>({
    pull(controller) {
      if (index >= frames.length) {
        controller.close();
        return;
      }
      controller.enqueue(frames[index] as AudioFrame);
      index += 1;
    },
  });
}
