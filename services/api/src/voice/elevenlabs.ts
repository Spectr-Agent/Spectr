import { voiceConfig } from "./config.js";

const API_BASE = "https://api.elevenlabs.io";

/**
 * Output formats a caller may ask for. The voice, model and settings stay pinned in
 * `voiceConfig`; only the audio encoding changes. `pcm_24000` is raw 16-bit
 * little-endian mono at 24 kHz, for live calls that play frames as they arrive.
 */
export type TtsOutputFormat = typeof voiceConfig.outputFormat | "pcm_24000" | "pcm_16000";

export interface TtsClient {
  stream(
    text: string,
    opts: { signal: AbortSignal; outputFormat?: TtsOutputFormat },
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
  const base = new URL(
    `/v1/text-to-speech/${encodeURIComponent(voiceConfig.voiceId)}/stream`,
    API_BASE,
  );

  return {
    async stream(text, { signal, outputFormat = voiceConfig.outputFormat }) {
      const url = new URL(base);
      url.searchParams.set("output_format", outputFormat);
      const response = await fetchImpl(url.toString(), {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          accept: outputFormat.startsWith("pcm_") ? "audio/pcm" : voiceConfig.contentType,
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
