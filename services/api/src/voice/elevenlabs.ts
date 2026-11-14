import { voiceConfig } from "./config.js";

const API_BASE = "https://api.elevenlabs.io";

export interface TtsClient {
  stream(
    text: string,
    opts: { signal: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>>;
}

export class TtsError extends Error {
  readonly name = "TtsError";
  readonly status: number;

  constructor(status: number) {
    super(`ElevenLabs text-to-speech request failed with status ${status}`);
    this.status = status;
  }
}

export function createElevenLabsClient({
  apiKey,
  fetchImpl = fetch,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
}): TtsClient {
  const url = new URL(
    `/v1/text-to-speech/${encodeURIComponent(voiceConfig.voiceId)}/stream`,
    API_BASE,
  );
  url.searchParams.set("output_format", voiceConfig.outputFormat);

  return {
    async stream(text, { signal }) {
      const response = await fetchImpl(url.toString(), {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          accept: voiceConfig.contentType,
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: voiceConfig.modelId,
          voice_settings: voiceConfig.voiceSettings,
        }),
      });

      if (!response.ok) {
        // The error body can echo the request text, so it is discarded unread.
        await response.body?.cancel().catch(() => {});
        throw new TtsError(response.status);
      }

      if (!response.body) {
        throw new TtsError(response.status);
      }

      return response.body;
    },
  };
}
