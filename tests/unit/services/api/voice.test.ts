import { describe, expect, it, vi } from "vitest";
import { loadVoiceEnv, voiceConfig } from "../../../../services/api/src/voice/config.js";
import {
  createFixtureStatusTextSource,
  createSupabaseAuthVerifier,
  createSupabaseStatusTextSource,
} from "../../../../services/api/src/voice/deps.js";
import { createElevenLabsClient, TtsError, type TtsClient } from "../../../../services/api/src/voice/elevenlabs.js";
import { createSpeechHandler } from "../../../../services/api/src/voice/speech.js";

describe("loadVoiceEnv", () => {
  it("requires the api key and the pinned voice", () => {
    expect(() => loadVoiceEnv({})).toThrow("ELEVENLABS_API_KEY is not set");
    expect(loadVoiceEnv({ ELEVENLABS_API_KEY: "k" })).toEqual({ apiKey: "k" });
    expect(loadVoiceEnv({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: voiceConfig.voiceId })).toEqual({ apiKey: "k" });
    expect(() => loadVoiceEnv({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "other" })).toThrow("pinned");
  });
});

describe("voice deps", () => {
  it("fixture status source resolves owner and text by task and seq", async () => {
    const source = createFixtureStatusTextSource([
      { taskId: "t1", ownerId: "o1", seq: 1, text: "Working" },
      { taskId: "t1", ownerId: "o1", seq: 2, text: null },
    ]);
    expect(await source.get("t9", 1)).toBeNull();
    expect(await source.get("t1", 1)).toEqual({ ownerId: "o1", text: "Working" });
    expect(await source.get("t1", 2)).toEqual({ ownerId: "o1", text: null });
    expect(await source.get("t1", 9)).toEqual({ ownerId: "o1", text: null });
  });

  it("supabase implementations are still pending", () => {
    expect(() => createSupabaseAuthVerifier()).toThrow("not implemented");
    expect(() => createSupabaseStatusTextSource()).toThrow("not implemented");
  });
});

describe("createElevenLabsClient gaps", () => {
  const client = (fetchImpl: typeof fetch): TtsClient => createElevenLabsClient({ apiKey: "k", fetchImpl });

  it("cancels the error body and throws TtsError on failure", async () => {
    const cancel = vi.fn(async () => undefined);
    const tts = client((async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1)); c.close(); } }), { status: 500 })) as typeof fetch);
    const failing = client((async () => ({ ok: false, status: 500, body: { cancel } })) as unknown as typeof fetch);
    await expect(failing.stream("hi", { signal: new AbortController().signal })).rejects.toThrow(TtsError);
    expect(cancel).toHaveBeenCalled();
    void tts;
  });

  it("throws TtsError when the response has no body", async () => {
    const tts = client((async () => ({ ok: true, status: 200, body: null })) as unknown as typeof fetch);
    await expect(tts.stream("hi", { signal: new AbortController().signal })).rejects.toThrow(TtsError);
  });
});

describe("createSpeechHandler gaps", () => {
  const handler = (over: { text?: string | null; tts?: TtsClient } = {}) => {
    const log = { info: vi.fn() };
    return {
      log,
      handle: createSpeechHandler({
        auth: { ownerIdFrom: async () => "o1" },
        statusText: createFixtureStatusTextSource([{ taskId: "t1", ownerId: "o1", seq: 0, text: over.text ?? "Working" }]),
        tts: over.tts ?? { stream: async () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.close(); } }) },
        log,
      }),
    };
  };

  const post = (body: string) => new Request("http://x", { method: "POST", body });

  it("rejects malformed JSON bodies", async () => {
    const { handle } = handler();
    expect((await handle(post("not json"), { taskId: "t1" })).status).toBe(400);
  });

  it("streams audio and clears the reader on cancel", async () => {
    const { handle } = handler();
    const response = await handle(post('{"seq":0}'), { taskId: "t1" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(voiceConfig.contentType);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.value).toEqual(new Uint8Array([1, 2]));
    await reader.cancel();
  });
});

describe("speech stream cancel", () => {
  it("aborts the tts read when the response body is cancelled", async () => {
    const ttsCancel = vi.fn(async () => undefined);
    const tts: TtsClient = {
      stream: async () => new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(new Uint8Array([1])); c.enqueue(new Uint8Array([2])); },
        cancel: ttsCancel,
      }),
    };
    const handle = createSpeechHandler({
      auth: { ownerIdFrom: async () => "o1" },
      statusText: createFixtureStatusTextSource([{ taskId: "t1", ownerId: "o1", seq: 0, text: "Working" }]),
      tts,
      log: { info: vi.fn() },
    });
    const response = await handle(new Request("http://x", { method: "POST", body: '{"seq":0}' }), { taskId: "t1" });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(ttsCancel).toHaveBeenCalled();
  });
});
