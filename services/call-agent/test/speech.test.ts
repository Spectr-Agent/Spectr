import { describe, expect, it } from "vitest";
import type { TtsClient } from "../../api/src/voice/elevenlabs.js";
import { createSpeaker, pcmFrames, SAMPLES_PER_FRAME } from "../src/speech.js";

async function* chunks(...parts: number[][]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield new Uint8Array(part);
}

function pcm(samples: number[]): number[] {
  const bytes: number[] = [];
  for (const sample of samples) bytes.push(sample & 0xff, (sample >> 8) & 0xff);
  return bytes;
}

describe("pcmFrames", () => {
  it("reassembles samples split across chunk boundaries, including a split sample", async () => {
    const samples = Array.from({ length: 6 }, (_, i) => (i + 1) * 100 - 300);
    const bytes = pcm(samples);
    const frames = [];
    for await (const frame of pcmFrames(chunks(bytes.slice(0, 3), bytes.slice(3, 7), bytes.slice(7)), 24_000, 3)) {
      frames.push(Array.from(frame.data));
    }
    expect(frames).toEqual([samples.slice(0, 3), samples.slice(3, 6)]);
  });

  it("pads a final partial frame with silence and drops a dangling half sample", async () => {
    const frames = [];
    for await (const frame of pcmFrames(chunks([...pcm([7]), 0x01]), 24_000, 4)) frames.push(Array.from(frame.data));
    expect(frames).toEqual([[7, 0, 0, 0]]);
  });
});

describe("createSpeaker", () => {
  it("asks Colby's client for PCM in the pinned voice and yields 20 ms frames", async () => {
    const requests: { text: string; outputFormat?: string }[] = [];
    const tts: TtsClient = {
      async stream(text, { outputFormat }) {
        requests.push({ text, outputFormat });
        const body = new Uint8Array(SAMPLES_PER_FRAME * 2 * 2 + 10);
        return new ReadableStream({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        });
      },
    };
    const reader = createSpeaker(tts)("Done.").getReader();
    let frames = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      expect(value.sampleRate).toBe(24_000);
      expect(value.samplesPerChannel).toBe(SAMPLES_PER_FRAME);
      frames += 1;
    }
    expect(frames).toBe(3);
    expect(requests).toEqual([{ text: "Done.", outputFormat: "pcm_24000" }]);
  });

  it("surfaces a TTS failure as a stream error instead of silence", async () => {
    const tts: TtsClient = {
      async stream() {
        throw new Error("ElevenLabs down");
      },
    };
    await expect(createSpeaker(tts)("Hi").getReader().read()).rejects.toThrow("ElevenLabs down");
  });
});
