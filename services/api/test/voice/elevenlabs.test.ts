import { voiceConfig } from "../../src/voice/config.js";
import {
  TtsError,
  createElevenLabsClient,
} from "../../src/voice/elevenlabs.js";
import { describe, expect, it, vi } from "vitest";

const API_KEY = "sk_test_never_logged";

function audioResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": voiceConfig.contentType } },
  );
}

function makeClient(response: () => Response) {
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    response(),
  );
  return {
    fetchImpl,
    client: createElevenLabsClient({
      apiKey: API_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  };
}

function lastCall(fetchImpl: ReturnType<typeof makeClient>["fetchImpl"]) {
  const call = fetchImpl.mock.calls.at(-1);
  if (!call) throw new Error("fetchImpl was never called");
  const [url, init] = call;
  return {
    url: String(url),
    init: init ?? {},
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
  };
}

describe("createElevenLabsClient", () => {
  it("always requests the pinned voice, model, settings and output format", async () => {
    const { client, fetchImpl } = makeClient(audioResponse);
    const texts = [
      "Done. Slide five is now on screen.",
      "Stopping now. The last verified slide was two.",
      "",
    ];

    for (const text of texts) {
      await client.stream(text, { signal: new AbortController().signal });
      const call = lastCall(fetchImpl);

      expect(call.url).toContain(voiceConfig.voiceId);
      expect(call.url).toContain(`output_format=${voiceConfig.outputFormat}`);
      expect(call.init.method).toBe("POST");
      expect(call.body.text).toBe(text);
      expect(call.body.model_id).toBe(voiceConfig.modelId);
      expect(call.body.voice_settings).toEqual(voiceConfig.voiceSettings);
      expect(call.body).not.toHaveProperty("voice_id");
    }

    expect(fetchImpl).toHaveBeenCalledTimes(texts.length);
  });

  it("can return raw PCM for live calls while keeping the pinned voice, model and settings", async () => {
    const { client, fetchImpl } = makeClient(audioResponse);
    await client.stream("On it.", { signal: new AbortController().signal, outputFormat: "pcm_24000" });
    const call = lastCall(fetchImpl);
    expect(call.url).toContain("output_format=pcm_24000");
    expect(call.url).not.toContain(`output_format=${voiceConfig.outputFormat}`);
    expect(call.headers.get("accept")).toBe("audio/pcm");
    expect(call.url).toContain(voiceConfig.voiceId);
    expect(call.body.model_id).toBe(voiceConfig.modelId);
    expect(call.body.voice_settings).toEqual(voiceConfig.voiceSettings);

    // The default stays MP3 for the app's speech endpoint.
    await client.stream("Done.", { signal: new AbortController().signal });
    expect(lastCall(fetchImpl).url).toContain(`output_format=${voiceConfig.outputFormat}`);
  });

  it("sends the API key as xi-api-key and forwards the abort signal", async () => {
    const { client, fetchImpl } = makeClient(audioResponse);
    const controller = new AbortController();

    await client.stream("Done.", { signal: controller.signal });
    const call = lastCall(fetchImpl);

    expect(call.headers.get("xi-api-key")).toBe(API_KEY);
    expect(call.init.signal).toBe(controller.signal);
  });

  it("returns the response body as a stream of audio chunks", async () => {
    const { client } = makeClient(audioResponse);

    const stream = await client.stream("Done.", {
      signal: new AbortController().signal,
    });
    const { value } = await stream.getReader().read();

    expect(value).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("throws TtsError with the status for a non-2xx response", async () => {
    for (const status of [401, 429, 500]) {
      const { client } = makeClient(
        () => new Response("upstream error", { status }),
      );

      const error = await client
        .stream("Done.", { signal: new AbortController().signal })
        .then(() => null)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(TtsError);
      expect((error as TtsError).status).toBe(status);
    }
  });

  it("never puts the API key or the request text in a thrown error message", async () => {
    const { client } = makeClient(
      () => new Response("invalid api key", { status: 401 }),
    );
    const text = "Done. Slide five is now on screen.";

    const error = await client
      .stream(text, { signal: new AbortController().signal })
      .then(() => null)
      .catch((caught: unknown) => caught as Error);

    expect(error).toBeInstanceOf(TtsError);
    expect(String(error)).not.toContain(API_KEY);
    expect(String(error)).not.toContain(text);
  });
});
