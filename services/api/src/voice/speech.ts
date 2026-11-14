import { z } from "zod";
import { voiceConfig } from "./config.js";
import { TtsError, type TtsClient } from "./elevenlabs.js";
import type { AuthVerifier, StatusTextSource } from "./deps.js";

const SpeechRequestSchema = z
  .object({ seq: z.number().int().nonnegative() })
  .strict();

export interface SpeechLog {
  info(entry: {
    taskId: string;
    seq: number | null;
    ms: number;
    fallback: boolean;
    ttsStatus?: number;
  }): void;
}

export interface SpeechDeps {
  auth: AuthVerifier;
  statusText: StatusTextSource;
  tts: TtsClient;
  timeoutMs?: number;
  now?: () => number;
  log?: SpeechLog;
}

export type SpeechHandler = (
  req: Request,
  params: { taskId: string },
) => Promise<Response>;

export function createSpeechHandler({
  auth,
  statusText,
  tts,
  timeoutMs = voiceConfig.timeoutMs,
  now = Date.now,
  log = console,
}: SpeechDeps): SpeechHandler {
  return async function handleSpeech(req, { taskId }) {
    const startedAt = now();
    let seq: number | null = null;

    const respond = (
      response: Response,
      fallback: boolean,
      ttsStatus?: number,
    ): Response => {
      log.info({
        taskId,
        seq,
        ms: now() - startedAt,
        fallback,
        ...(ttsStatus === undefined ? {} : { ttsStatus }),
      });
      return response;
    };

    const ownerId = await auth.ownerIdFrom(req);
    if (ownerId === null) {
      return respond(jsonError(401, "unauthorized"), false);
    }

    const body = SpeechRequestSchema.safeParse(await readJson(req));
    if (!body.success) {
      return respond(jsonError(400, "invalid_request"), false);
    }
    seq = body.data.seq;

    const row = await statusText.get(taskId, seq);
    if (row === null || row.ownerId !== ownerId) {
      return respond(jsonError(404, "not_found"), false);
    }

    const text = (row.text ?? "").trim().slice(0, voiceConfig.maxTextChars);
    if (text.length === 0) {
      return respond(jsonError(409, "no_status_text"), false);
    }

    const abort = new AbortController();
    const first = await raceFirstChunk(
      () => tts.stream(text, { signal: abort.signal }),
      timeoutMs,
    );

    if (first.kind !== "chunk") {
      abort.abort();
      await first.reader?.cancel().catch(() => {});
      return respond(
        Response.json(
          { fallback: true, text },
          { headers: { "cache-control": "no-store" } },
        ),
        true,
        first.kind === "error" ? first.status : undefined,
      );
    }

    const { chunk, reader } = first;
    return respond(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(chunk);
          },
          async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
          },
          async cancel() {
            abort.abort();
            await reader.cancel().catch(() => {});
          },
        }),
        {
          headers: {
            "content-type": voiceConfig.contentType,
            "cache-control": "no-store",
          },
        },
      ),
      false,
    );
  };
}

type FirstChunk =
  | { kind: "chunk"; chunk: Uint8Array; reader: StreamReader }
  | { kind: "timeout"; reader?: StreamReader }
  | { kind: "error"; status?: number; reader?: StreamReader };

type StreamReader = ReadableStreamDefaultReader<Uint8Array>;

// Time-to-first-chunk is the deadline: headers are only sent once a chunk
// arrives, so the JSON fallback stays available until then.
async function raceFirstChunk(
  open: () => Promise<ReadableStream<Uint8Array>>,
  timeoutMs: number,
): Promise<FirstChunk> {
  let reader: StreamReader | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const firstChunk = (async (): Promise<FirstChunk> => {
    try {
      reader = (await open()).getReader();
      const { done, value } = await reader.read();
      if (done || value === undefined) {
        return { kind: "error" };
      }
      return { kind: "chunk", chunk: value, reader };
    } catch (error) {
      return {
        kind: "error",
        status: error instanceof TtsError ? error.status : undefined,
      };
    }
  })();

  const timeout = new Promise<FirstChunk>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });

  try {
    const outcome = await Promise.race([firstChunk, timeout]);
    return outcome.kind === "chunk" ? outcome : { ...outcome, reader };
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function jsonError(status: number, error: string): Response {
  return Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}
