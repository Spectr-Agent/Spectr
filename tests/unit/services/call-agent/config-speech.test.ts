import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../../../services/call-agent/src/config.js";
import { createSpeaker, pcmFrames, SAMPLE_RATE, SAMPLES_PER_FRAME } from "../../../../services/call-agent/src/speech.js";
import type { TtsClient } from "../../../../services/api/src/voice/elevenlabs.js";

const goodEnv = {
  LIVEKIT_URL: "wss://x.livekit.cloud",
  LIVEKIT_API_KEY: "k",
  LIVEKIT_API_SECRET: "s",
  ELEVENLABS_API_KEY: "e",
  POSTGRES_URL: "postgres://x",
};

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv({ ...goodEnv });
    expect(env.SPECTR_CALL_AGENT_NAME).toBe("spectr-call");
    expect(env.SPECTR_CALL_STT_MODEL).toBe("deepgram/nova-3");
    expect(env.SPECTR_FACETIME_OWNER_PHONE).toBeUndefined();
  });

  it("lists the missing variables", () => {
    expect(() => loadEnv({})).toThrow(/LIVEKIT_URL.*POSTGRES_URL/su);
  });
});

describe("pcmFrames", () => {
  async function* chunks(...buffers: Uint8Array[]) {
    for (const b of buffers) yield b;
  }

  it("splits arbitrary chunk boundaries into 20 ms frames", async () => {
    const one = new Uint8Array(SAMPLES_PER_FRAME * 2);
    one[0] = 1;
    one[1] = 0;
    const half = new Uint8Array(SAMPLES_PER_FRAME);
    const frames = [];
    for await (const frame of pcmFrames(chunks(one, half))) frames.push(frame);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.sampleRate).toBe(SAMPLE_RATE);
    expect(frames[0]!.samplesPerChannel).toBe(SAMPLES_PER_FRAME);
    expect(frames[0]!.data[0]).toBe(1);
  });

  it("pads a trailing partial frame and drops lone bytes", async () => {
    const frames = [];
    for await (const frame of pcmFrames(chunks(new Uint8Array([1, 0, 7])))) frames.push(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data[0]).toBe(1);
    expect(frames[0]!.data[1]).toBe(0);
  });
});

describe("createSpeaker", () => {
  it("streams tts audio into frames and clips long text", async () => {
    const tts: TtsClient = {
      stream: vi.fn(async (text: string) =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(SAMPLES_PER_FRAME * 2));
            controller.close();
          },
        }),
      ),
    };
    const speak = createSpeaker(tts, 60_000);
    const stream = speak("x".repeat(5_000));
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    const second = await reader.read();
    expect(second.done).toBe(true);
    expect(tts.stream).toHaveBeenCalledWith(expect.stringMatching(/^x+$/u), expect.objectContaining({ outputFormat: "pcm_24000" }));
    expect((tts.stream as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveLength(300);
  });

  it("propagates tts errors into the stream", async () => {
    const tts: TtsClient = { stream: async () => { throw new Error("tts down"); } };
    const reader = createSpeaker(tts)("hi").getReader();
    await expect(reader.read()).rejects.toThrow("tts down");
  });

  it("cancelling the stream aborts the tts call", async () => {
    const tts: TtsClient = { stream: vi.fn(async () => new Promise<ReadableStream<Uint8Array>>(() => undefined)) };
    const stream = createSpeaker(tts)("hi");
    await stream.cancel();
    const signal = (tts.stream as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.signal;
    if (signal) expect(signal.aborted).toBe(true);
  });
});

describe("createSpeaker caller signal", () => {
  it("aborts the tts call when the caller signal fires", async () => {
    const tts: TtsClient = { stream: vi.fn(async () => new Promise<ReadableStream<Uint8Array>>(() => undefined)) };
    const caller = new AbortController();
    createSpeaker(tts)("hi", caller.signal);
    caller.abort();
    const signal = (tts.stream as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.signal;
    if (signal) expect(signal.aborted).toBe(true);
  });
});
