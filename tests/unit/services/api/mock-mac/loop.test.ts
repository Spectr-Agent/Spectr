import { describe, expect, it, vi } from "vitest";
import { runMockMac } from "../../../../../services/api/src/mock-mac/loop.js";
import type { MacAction, MacStepResponse } from "../../../../../services/api/src/contracts.js";
import type { ActionResult, MockMacExecutor } from "../../../../../services/api/src/mock-mac/executors.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const shot = { mediaType: "image/png" as const, data: "aGk=", width: 100, height: 100 };
const task = (step = 0) => ({ task: { taskId: "tsk_1", revision: 1, state: "running", instruction: "do it", step } });
const finished = (state = "succeeded"): MacStepResponse => ({
  kind: "finished",
  taskId: "tsk_1",
  step: 1,
  state,
  summary: "Done.",
});
const actions = (...items: Array<[string, MacAction]>) => ({
  kind: "actions" as const,
  taskId: "tsk_1",
  step: 1,
  revision: 1,
  actions: items.map(([actionId, action]) => ({ actionId, action })),
});

type Step = Response | Error | (() => Promise<Response> | Response);

/** A fetch stub that plays responses (or throws) in order. */
function scriptedFetch(steps: Step[]) {
  const urls: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const step = steps.shift();
    if (!step) throw new Error(`unexpected fetch ${urls.length}`);
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step() : step;
  });
  return { fetcher: fetcher as unknown as typeof fetch, urls };
}

const executor = (results: ActionResult[] = []) =>
  ({
    screenshot: vi.fn(async () => shot),
    execute: vi.fn(async () => results.shift() ?? { ok: true, output: "OK" }),
  }) satisfies MockMacExecutor;

const options = (fetcher: typeof fetch, exec: MockMacExecutor, extra: object = {}) => ({
  apiUrl: "https://api.test",
  token: "tok",
  executor: exec,
  fetch: fetcher,
  sleep: vi.fn(async () => {}),
  log: vi.fn(),
  once: true,
  pollMs: 1,
  ...extra,
});

describe("runMockMac", () => {
  it("runs a task to completion once", async () => {
    const { fetcher, urls } = scriptedFetch([json(task()), json(finished())]);
    const exec = executor();
    const result = await runMockMac(options(fetcher, exec));
    expect(result).toMatchObject({ kind: "finished", state: "succeeded" });
    expect(urls[0]).toBe("https://api.test/api/mac/task");
    expect(urls[1]).toBe("https://api.test/api/mac/step");
  });

  it("executes returned actions and reports their results", async () => {
    const click: MacAction = { type: "click", x: 1, y: 2, button: "left", clicks: 1, modifiers: [] } as MacAction;
    const { fetcher } = scriptedFetch([json(task()), json(actions(["a1", click])), json(finished())]);
    const exec = executor([{ ok: true, output: "OK" }]);
    const result = await runMockMac(options(fetcher, exec));
    expect(exec.execute).toHaveBeenCalledWith(click);
    expect(result!.kind).toBe("finished");
  });

  it("stops the batch on the first failed action", async () => {
    const click: MacAction = { type: "click", x: 1, y: 1, button: "left", clicks: 1, modifiers: [] } as MacAction;
    const { fetcher } = scriptedFetch([json(task()), json(actions(["a1", click], ["a2", click])), json(finished())]);
    const exec = executor([{ ok: false, error: "missed" }]);
    await runMockMac(options(fetcher, exec));
    expect(exec.execute).toHaveBeenCalledTimes(1);
  });

  it("records a thrown executor error as a failed result", async () => {
    const click: MacAction = { type: "click", x: 1, y: 1, button: "left", clicks: 1, modifiers: [] } as MacAction;
    const { fetcher } = scriptedFetch([json(task()), json(actions(["a1", click])), json(finished())]);
    const exec = {
      screenshot: vi.fn(async () => shot),
      execute: vi.fn(async () => {
        throw "weird";
      }),
    } satisfies MockMacExecutor;
    const postBodies: string[] = [];
    const wrapping = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) postBodies.push(String(init.body));
      return fetcher(input, init);
    });
    await runMockMac(options(wrapping as unknown as typeof fetch, exec));
    const body = JSON.parse(postBodies.at(-1)!);
    expect(body.results[0]).toMatchObject({ actionId: "a1", ok: false, error: "Mock Mac action failed." });
  });

  it("polls again when no task is waiting", async () => {
    const { fetcher } = scriptedFetch([json({ task: null }), json(task()), json(finished())]);
    const result = await runMockMac(options(fetcher, executor()));
    expect(result!.kind).toBe("finished");
  });

  it("throws on a 401 task poll", async () => {
    const { fetcher } = scriptedFetch([json({}, 401)]);
    await expect(runMockMac(options(fetcher, executor()))).rejects.toThrow("HTTP 401");
  });

  it("throws on a non-retryable task poll status", async () => {
    const { fetcher } = scriptedFetch([json({}, 403)]);
    await expect(runMockMac(options(fetcher, executor()))).rejects.toThrow("HTTP 403");
  });

  it("retries 5xx task polls then returns to polling", async () => {
    const { fetcher } = scriptedFetch([
      json({}, 500), json({}, 500), json({}, 500), json({}, 500), json({}, 500),
      json(task()), json(finished()),
    ]);
    const log = vi.fn();
    const result = await runMockMac(options(fetcher, executor(), { log }));
    expect(result!.kind).toBe("finished");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("HTTP 500"));
  });

  it("retries network failures on the task poll", async () => {
    const { fetcher } = scriptedFetch([
      new Error("down"), new Error("down"), new Error("down"), new Error("down"), new Error("down"),
      json(task()), json(finished()),
    ]);
    const log = vi.fn();
    const result = await runMockMac(options(fetcher, executor(), { log }));
    expect(result!.kind).toBe("finished");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("after 5 tries"));
  });

  it("throws on a 401 step post", async () => {
    const { fetcher } = scriptedFetch([json(task()), json({}, 401)]);
    await expect(runMockMac(options(fetcher, executor()))).rejects.toThrow("HTTP 401");
  });

  it("re-reads the task on a 409 and continues", async () => {
    const { fetcher } = scriptedFetch([
      json(task()),
      json({}, 409),
      json(task(3)),
      json(finished()),
    ]);
    const result = await runMockMac(options(fetcher, executor()));
    expect(result!.kind).toBe("finished");
  });

  it("goes back to polling when the 409 re-read finds no task", async () => {
    const { fetcher } = scriptedFetch([
      json(task()),
      json({}, 409),
      json({ task: null }),
      json(task()),
      json(finished()),
    ]);
    const result = await runMockMac(options(fetcher, executor()));
    expect(result!.kind).toBe("finished");
  });

  it("retries 5xx step posts and then polls again", async () => {
    const { fetcher } = scriptedFetch([
      json(task()),
      json({}, 500), json({}, 500), json({}, 500), json({}, 500), json({}, 500),
      json(task()),
      json(finished()),
    ]);
    const log = vi.fn();
    const result = await runMockMac(options(fetcher, executor(), { log }));
    expect(result!.kind).toBe("finished");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("request failed with HTTP 500"));
  });

  it.each([
    [{ error: { message: "task is gone" } }, "task is gone"],
    ["<html>", "Mock Mac request failed."],
  ])("reports step post HTTP %s details", async (body, message) => {
    const step = body === "<html>" ? () => new Response("oops", { status: 422 }) : () => json(body, 422);
    const { fetcher } = scriptedFetch([json(task()), step, step, step, step, step, json(task()), json(finished())]);
    const log = vi.fn();
    const result = await runMockMac(options(fetcher, executor(), { log }));
    expect(result!.kind).toBe("finished");
    expect(log).toHaveBeenCalledWith(expect.stringContaining(message));
  });

  it("logs a waiting question once and resumes on the next step", async () => {
    const waiting: MacStepResponse = { kind: "waiting", taskId: "tsk_1", step: 1, question: "Which list?" };
    const { fetcher } = scriptedFetch([json(task()), json(waiting), json(waiting), json(finished())]);
    const log = vi.fn();
    await runMockMac(options(fetcher, executor(), { log }));
    expect(log.mock.calls.filter((c) => String(c[0]).includes("Which list?"))).toHaveLength(1);
  });

  it("keeps polling after a finished task when not in once mode", async () => {
    const { fetcher } = scriptedFetch([json(task()), json(finished()), json({ task: null })]);
    const log = vi.fn();
    const sleep = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("stop the loop"));
    // once:false means a finished task returns to the poll loop; the sleep throw ends the run.
    await expect(runMockMac(options(fetcher, executor(), { log, sleep, once: false }))).rejects.toThrow("stop the loop");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("finished succeeded"));
  });
});

describe("runMockMac action lines", () => {
  it("describes every action type and paces an empty poll with the default sleep", async () => {
    const allActions: MacAction[] = [
      { type: "click", x: 1, y: 2, button: "left", clicks: 1, modifiers: [] },
      { type: "mouseMove", x: 1, y: 2 },
      { type: "drag", fromX: 1, fromY: 2, toX: 3, toY: 4, modifiers: [] },
      { type: "scroll", x: null, y: null, direction: "down", amount: 2, modifiers: [] },
      { type: "type", text: "hi" },
      { type: "key", keys: "return", repeat: 2 },
      { type: "wait", seconds: 1 },
      { type: "openApp", name: "Notes" },
      { type: "openUrl", url: "https://a.b" },
      { type: "screenshot" },
    ];
    const { fetcher } = scriptedFetch([
      json({ task: null }), // empty poll: the default sleep paces the next attempt
      json(task()),
      json(actions(...allActions.map((action, i) => [`a${i}`, action] as [string, MacAction]))),
      json(finished()),
    ]);
    const lines: string[] = [];
    const opts = options(fetcher, executor(), { log: (line: string) => lines.push(line) });
    delete (opts as Record<string, unknown>).sleep; // exercise the default sleepFor seam
    const result = await runMockMac(opts);
    expect(result).toMatchObject({ kind: "finished", state: "succeeded" });
    expect(lines.join("\n")).toContain("step 1: click 1,2 left x1");
    expect(lines.join("\n")).toContain("step 1: scroll down 2");
    expect(lines.join("\n")).toContain("step 1: open app Notes");
    expect(lines.join("\n")).toContain("finished succeeded: Done.");
  });
});
