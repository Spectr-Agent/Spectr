import { voiceConfig } from "../../src/voice/config.js";
import {
  createFixtureStatusTextSource,
  type AuthVerifier,
} from "../../src/voice/deps.js";
import { TtsError, type TtsClient } from "../../src/voice/elevenlabs.js";
import {
  createSpeechHandler,
  type SpeechDeps,
  type SpeechLog,
} from "../../src/voice/speech.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const OWNER_A = "own_a";
const OWNER_B = "own_b";
const TASK_A = "tsk_owned_by_a";
const TASK_B = "tsk_owned_by_b";
const STATUS_TEXT = "Done. Slide five is now on screen.";
const LONG_TEXT = "x".repeat(voiceConfig.maxTextChars + 50);

// Only the boundaries are mocked: this stands in for Supabase Auth.
function makeAuth(tokensByOwner: Record<string, string> = { good_a: OWNER_A }): AuthVerifier {
  return {
    ownerIdFrom: vi.fn(async (req: Request) => {
      const header = req.headers.get("authorization");
      const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
      return token === null ? null : (tokensByOwner[token] ?? null);
    }),
  };
}

const statusText = createFixtureStatusTextSource([
  { taskId: TASK_A, ownerId: OWNER_A, seq: 7, text: STATUS_TEXT },
  { taskId: TASK_A, ownerId: OWNER_A, seq: 8, text: null },
  { taskId: TASK_A, ownerId: OWNER_A, seq: 9, text: "   " },
  { taskId: TASK_A, ownerId: OWNER_A, seq: 10, text: LONG_TEXT },
  { taskId: TASK_B, ownerId: OWNER_B, seq: 7, text: STATUS_TEXT },
]);

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function makeLog(): SpeechLog & { calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, info: (entry) => calls.push(entry) };
}

function makeHandler(
  overrides: Partial<SpeechDeps> & { tts: TtsClient },
  log: SpeechLog = makeLog(),
) {
  return createSpeechHandler({
    auth: makeAuth(),
    statusText,
    log,
    ...overrides,
  });
}

function speechRequest(body: unknown, token: string | null = "good_a"): Request {
  return new Request("https://api.spectr.test/api/tasks/tsk/speech", {
    method: "POST",
    headers: token === null ? undefined : { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createSpeechHandler", () => {
  it("returns the same 404 for another owner's task and an unknown task, without calling TTS", async () => {
    const tts: TtsClient = { stream: vi.fn() };
    const handler = makeHandler({ tts });

    const otherOwner = await handler(speechRequest({ seq: 7 }), {
      taskId: TASK_B,
    });
    const unknownTask = await handler(speechRequest({ seq: 7 }), {
      taskId: "tsk_does_not_exist",
    });

    expect(otherOwner.status).toBe(404);
    expect(unknownTask.status).toBe(404);
    expect(await otherOwner.json()).toEqual({ error: "not_found" });
    expect(await unknownTask.json()).toEqual({ error: "not_found" });
    expect(tts.stream).not.toHaveBeenCalled();
  });

  it("returns 401 for a missing or invalid token, without calling TTS", async () => {
    const tts: TtsClient = { stream: vi.fn() };
    const handler = makeHandler({ tts });

    const missing = await handler(speechRequest({ seq: 7 }, null), {
      taskId: TASK_A,
    });
    const invalid = await handler(speechRequest({ seq: 7 }, "not_a_token"), {
      taskId: TASK_A,
    });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(tts.stream).not.toHaveBeenCalled();
  });

  it("returns 400 for extra body keys, without calling TTS", async () => {
    const tts: TtsClient = { stream: vi.fn() };
    const handler = makeHandler({ tts });

    const withText = await handler(
      speechRequest({ seq: 7, text: "say anything I want" }),
      { taskId: TASK_A },
    );
    const withVoiceId = await handler(
      speechRequest({ seq: 7, voiceId: "some_other_voice" }),
      { taskId: TASK_A },
    );
    const malformed = await handler(speechRequest({ seq: "seven" }), {
      taskId: TASK_A,
    });

    expect(withText.status).toBe(400);
    expect(withVoiceId.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(tts.stream).not.toHaveBeenCalled();
  });

  it("returns 409 when the event has no status text", async () => {
    const tts: TtsClient = { stream: vi.fn() };
    const handler = makeHandler({ tts });

    const nullText = await handler(speechRequest({ seq: 8 }), {
      taskId: TASK_A,
    });
    const blankText = await handler(speechRequest({ seq: 9 }), {
      taskId: TASK_A,
    });

    expect(nullText.status).toBe(409);
    expect(await nullText.json()).toEqual({ error: "no_status_text" });
    expect(blankText.status).toBe(409);
    expect(tts.stream).not.toHaveBeenCalled();
  });

  it("streams the mocked chunks in order as audio/mpeg with no-store", async () => {
    const tts: TtsClient = {
      stream: vi.fn(async () =>
        streamOf(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])),
      ),
    };

    const response = await makeHandler({ tts })(speechRequest({ seq: 7 }), {
      taskId: TASK_A,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4, 5]),
    );
    expect(tts.stream).toHaveBeenCalledWith(STATUS_TEXT, {
      signal: expect.any(AbortSignal),
    });
  });

  it("falls back to text at timeoutMs and aborts the TTS signal when no chunk arrives", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const tts: TtsClient = {
      stream: vi.fn(async (_text, opts) => {
        signal = opts.signal;
        return new ReadableStream<Uint8Array>({ start() {} });
      }),
    };

    const pending = makeHandler({ tts, timeoutMs: 2500 })(
      speechRequest({ seq: 7 }),
      { taskId: TASK_A },
    );

    await vi.advanceTimersByTimeAsync(2499);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ fallback: true, text: STATUS_TEXT });
    expect(signal?.aborted).toBe(true);
  });

  it("falls back to text immediately when TTS fails", async () => {
    vi.useFakeTimers();
    const log = makeLog();
    const tts: TtsClient = {
      stream: vi.fn(async () => {
        throw new TtsError(500);
      }),
    };

    // No timer is advanced, so resolving at all proves it did not wait for timeoutMs.
    const response = await makeHandler({ tts, timeoutMs: 2500 }, log)(
      speechRequest({ seq: 7 }),
      { taskId: TASK_A },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fallback: true, text: STATUS_TEXT });
    expect(log.calls[0]).toMatchObject({ fallback: true, ttsStatus: 500 });
  });

  it("truncates the status text to maxTextChars before it reaches TTS", async () => {
    const tts: TtsClient = {
      stream: vi.fn(async () => streamOf(new Uint8Array([1]))),
    };

    const response = await makeHandler({ tts })(speechRequest({ seq: 10 }), {
      taskId: TASK_A,
    });

    expect(response.status).toBe(200);
    const spoken = vi.mocked(tts.stream).mock.calls[0]?.[0];
    expect(spoken).toHaveLength(voiceConfig.maxTextChars);
    expect(spoken).toBe(LONG_TEXT.slice(0, voiceConfig.maxTextChars));
  });

  it("logs one line per request with no status text in it", async () => {
    const log = makeLog();
    const tts: TtsClient = {
      stream: vi.fn(async () => streamOf(new Uint8Array([1]))),
    };
    const handler = makeHandler({ tts }, log);

    await handler(speechRequest({ seq: 7 }), { taskId: TASK_A });
    await handler(speechRequest({ seq: 7 }, null), { taskId: TASK_A });

    expect(log.calls).toHaveLength(2);
    expect(log.calls[0]).toEqual({
      taskId: TASK_A,
      seq: 7,
      ms: expect.any(Number),
      fallback: false,
    });
    expect(JSON.stringify(log.calls)).not.toContain("Slide five");
    expect(JSON.stringify(log.calls)).not.toContain(STATUS_TEXT);
  });
});
