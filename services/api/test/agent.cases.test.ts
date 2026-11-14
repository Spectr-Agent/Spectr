// Agent behavior by task type, not by app. Each case uses a fake Claude and the
// in-memory store, so it runs anywhere. The same types appear in the live run
// (agent.live.test.ts) against real Claude.

import { afterEach, describe, expect, it, vi } from "vitest";
import { MacStepRequestSchema, MacStepResponseSchema, type MacStepRequest } from "../src/contracts.js";
import type { AnthropicRequest, AnthropicResponse, CallClaude } from "../src/agent/anthropic.js";
import { slideFromText, targetSlide } from "../src/agent/slides.js";
import { runAgentStep } from "../src/agent/step.js";
import type { ToolUse } from "../src/agent/tools.js";
import { InMemoryTaskStore } from "../src/memory-store.js";

const deviceId = "dev_cases_mac";
const ownerId = "owner_cases";

afterEach(() => {
  vi.restoreAllMocks();
});

// --- helpers (same shapes as test/agent.test.ts) -----------------------------

function request(taskId: string, overrides: Partial<MacStepRequest> = {}): MacStepRequest {
  return MacStepRequestSchema.parse({
    taskId,
    afterStep: 0,
    screenshot: { mediaType: "image/png", data: "aGVsbG8=", width: 100, height: 100 },
    results: [],
    ...overrides,
  });
}

async function say(store: InMemoryTaskStore, text: string, id = `msg-${Math.random()}`) {
  return store.routeInbound({
    providerMessageId: id,
    ownerId,
    deviceId,
    text,
    replyProvider: "sendblue",
    replyHandle: "+15555550100",
    now: new Date(),
  });
}

const computer = (id: string, name: string, input: unknown = {}): ToolUse => ({ type: "tool_use", id, name, input, toolset_name: "computer" });
const custom = (id: string, name: string, input: unknown): ToolUse => ({ type: "tool_use", id, name, input });
const reply = (...content: unknown[]): AnthropicResponse => ({ content, stop_reason: "tool_use" });
const finish = (success: boolean, summary: string) => reply(custom(`finish-${Math.random()}`, "finish", { success, summary }));
const ask = (question: string) => reply(custom(`ask-${Math.random()}`, "ask_user", { question }));

/** A fake Claude that plays turns in order and snapshots what it was sent. */
function claude(...turns: AnthropicResponse[]) {
  const sent: AnthropicRequest[] = [];
  const call: CallClaude = vi.fn(async (body: AnthropicRequest) => {
    sent.push(structuredClone(body));
    const next = turns.shift();
    if (!next) throw new Error("Unexpected Claude call");
    return next;
  });
  return { call, sent, lastText: () => JSON.stringify(sent.at(-1)?.messages.at(-1)) };
}

async function step(store: InMemoryTaskStore, taskId: string, c: CallClaude, overrides: Partial<MacStepRequest> = {}) {
  const response = await runAgentStep({ store, deviceId, request: request(taskId, overrides), callClaude: c });
  return MacStepResponseSchema.parse(response);
}

// --- task types ------------------------------------------------------------------

describe("task types", () => {
  it("send/post/delete: asks first, continues only after the owner answers", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, "post 'see you at 7' in the team Slack channel");
    const c = claude(
      ask("Post 'see you at 7' in #team? Reply yes to go ahead."),
      reply(computer("key-1", "key", { text: "Return" })),
      finish(true, "The message is posted in #team."),
    );
    expect(await step(store, taskId, c.call)).toMatchObject({ kind: "waiting" });

    // Nothing runs while waiting.
    expect(await step(store, taskId, c.call, { afterStep: 1 })).toMatchObject({ kind: "waiting" });
    expect(c.call).toHaveBeenCalledTimes(1);

    expect((await say(store, "yes")).kind).toBe("answer");
    expect(await step(store, taskId, c.call, { afterStep: 1 })).toMatchObject({ kind: "actions" });
    expect(c.lastText()).toContain("yes");
    expect(await step(store, taskId, c.call, { afterStep: 2, results: [{ actionId: "key-1", ok: true }] })).toMatchObject({
      kind: "finished",
      state: "succeeded",
    });
  });

  it("send/post/delete: a 'no' reaches Claude and the task can end without sending", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, "delete the old screenshots folder");
    const c = claude(ask("Delete the folder 'Old Screenshots'?"), finish(false, "I left the folder alone."));
    await step(store, taskId, c.call);
    await say(store, "no, keep it");
    expect(await step(store, taskId, c.call, { afterStep: 1 })).toMatchObject({ kind: "finished", state: "failed" });
    expect(c.lastText()).toContain("no, keep it");
  });

  it("login: pauses for the owner to log in, then continues", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, "check my Canvas grades");
    const c = claude(
      ask("Canvas wants you to log in. Please log in on the Mac, then reply done."),
      finish(true, "Your Canvas grades page is open."),
    );
    expect(await step(store, taskId, c.call)).toMatchObject({ kind: "waiting" });
    await say(store, "done");
    expect(await step(store, taskId, c.call, { afterStep: 1 })).toMatchObject({ kind: "finished", state: "succeeded" });
  });

  it("change of mind before the Mac acts: the correction reaches Claude and a new step replaces the old one", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, "open YouTube");
    const c = claude(
      reply(custom("url-1", "open_url", { url: "https://www.youtube.com" })),
      reply(custom("url-2", "open_url", { url: "https://www.spotify.com" })),
    );
    const first = await step(store, taskId, c.call);
    expect(first).toMatchObject({ kind: "actions" });
    expect((await say(store, "actually open Spotify instead")).kind).toBe("correction");

    // The Mac didn't run url-1: it reports no results.
    const second = await step(store, taskId, c.call, { afterStep: 1 });
    expect(c.lastText()).toContain("actually open Spotify instead");
    expect(second).toMatchObject({ kind: "actions", actions: [{ actionId: "url-2", action: { type: "openUrl" } }] });
    if (first.kind === "actions" && second.kind === "actions") expect(second.revision).toBeGreaterThan(first.revision);
  });

  it("change of mind after the Mac acted: a new step is issued", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, "open Notes");
    const c = claude(reply(custom("app-1", "open_app", { name: "Notes" })), reply(custom("app-2", "open_app", { name: "Reminders" })));
    await step(store, taskId, c.call);
    await say(store, "wait, open Reminders");
    const next = await step(store, taskId, c.call, { afterStep: 1, results: [{ actionId: "app-1", ok: true }] });
    expect(next).toMatchObject({ kind: "actions", actions: [{ action: { type: "openApp", name: "Reminders" } }] });
  });

  it("stop mid-task: cancels without asking Claude again", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, "fill out the RSVP form");
    const c = claude(reply(computer("click-1", "left_click", { coordinate: [10, 10] })));
    await step(store, taskId, c.call);
    await say(store, "stop");
    expect(await step(store, taskId, c.call, { afterStep: 1 })).toMatchObject({ kind: "finished", state: "cancelled" });
    expect(c.call).toHaveBeenCalledTimes(1);
  });

  it("vague request: asks one question instead of guessing", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, "open that one");
    const c = claude(ask("Which app or website do you mean?"));
    expect(await step(store, taskId, c.call)).toMatchObject({ kind: "waiting", question: "Which app or website do you mean?" });
  });

  it("impossible task: the final screen doesn't show the goal, so it fails honestly", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, "book a table at a restaurant that doesn't exist");
    const c = claude(finish(false, "I couldn't find that restaurant."));
    expect(await step(store, taskId, c.call)).toMatchObject({
      kind: "finished",
      state: "failed",
      summary: "I couldn't find that restaurant.",
    });
  });

  it("duplicate answer: the same message delivered twice counts once", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, "send my mom the photo");
    const c = claude(ask("Send the latest photo to Mom?"), reply(computer("key-1", "key", { text: "Return" })));
    await step(store, taskId, c.call);
    await say(store, "yes", "provider-dup-1");
    await say(store, "yes", "provider-dup-1");
    await step(store, taskId, c.call, { afterStep: 1 });
    const text = c.lastText();
    expect(text.match(/yes/g)?.length).toBe(1);
  });

  it("failed action: the Mac's error reaches Claude", async () => {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, "open Figma");
    const c = claude(reply(custom("app-1", "open_app", { name: "Figma" })), finish(false, "Figma isn't installed."));
    await step(store, taskId, c.call);
    const done = await step(store, taskId, c.call, {
      afterStep: 1,
      results: [{ actionId: "app-1", ok: false, error: "App not found" }],
    });
    expect(c.lastText()).toContain("App not found");
    expect(done).toMatchObject({ kind: "finished", state: "failed" });
  });
});

// --- Keynote example: observedSlide double-check ----------------------------------

describe("Keynote example: observedSlide check", () => {
  async function slideTask(instruction: string) {
    const store = new InMemoryTaskStore();
    const { taskId } = await say(store, instruction);
    return { store, taskId };
  }

  it("succeeds when the Mac shows the slide asked for", async () => {
    const { store, taskId } = await slideTask("go to slide five");
    const c = claude(reply(computer("k", "key", { text: "Right" })), finish(true, "Slide 5 is showing."));
    await step(store, taskId, c.call, { observedSlide: 4 });
    expect(await step(store, taskId, c.call, { afterStep: 1, results: [{ actionId: "k", ok: true }], observedSlide: 5 })).toMatchObject({
      kind: "finished",
      state: "succeeded",
    });
  });

  it("fails with a clear message when the Mac shows a different slide, even if Claude says done", async () => {
    const { store, taskId } = await slideTask("go to slide five");
    const c = claude(reply(computer("k", "key", { text: "Right" })), finish(true, "Slide 5 is showing."));
    await step(store, taskId, c.call, { observedSlide: 2 });
    expect(await step(store, taskId, c.call, { afterStep: 1, results: [{ actionId: "k", ok: true }], observedSlide: 3 })).toMatchObject({
      kind: "finished",
      state: "failed",
      summary: "I asked for slide 5, but slide 3 is showing. Shall I try again?",
    });
  });

  it("a correction to another slide moves the target", async () => {
    const { store, taskId } = await slideTask("go to slide five");
    const c = claude(reply(computer("k", "key", { text: "Right" })), finish(true, "Slide 2 is showing."));
    await step(store, taskId, c.call, { observedSlide: 1 });
    await say(store, "actually slide two");
    expect(await step(store, taskId, c.call, { afterStep: 1, results: [{ actionId: "k", ok: true }], observedSlide: 2 })).toMatchObject({
      kind: "finished",
      state: "succeeded",
    });
  });

  it("a correction to a non-slide task clears the check", async () => {
    const { store, taskId } = await slideTask("go to slide five");
    const c = claude(reply(computer("k", "key", { text: "Right" })), finish(true, "YouTube is open."));
    await step(store, taskId, c.call);
    await say(store, "actually just open YouTube");
    expect(await step(store, taskId, c.call, { afterStep: 1, results: [{ actionId: "k", ok: true }], observedSlide: 3 })).toMatchObject({
      kind: "finished",
      state: "succeeded",
    });
  });

  it("without observedSlide, Claude's screenshot check decides as before", async () => {
    const { store, taskId } = await slideTask("go to slide 4");
    const c = claude(finish(true, "Slide 4 is showing."));
    expect(await step(store, taskId, c.call)).toMatchObject({ kind: "finished", state: "succeeded" });
  });
});

describe("slideFromText / targetSlide", () => {
  it.each([
    ["go to slide five", 5],
    ["slide 4", 4],
    ["slide number two", 2],
    ["go to slide for", 4],
    ["slide too please", 2],
    ["show me the first slide", 1],
    ["Actually, slide TWELVE!", 12],
  ])("%s -> %i", (text, n) => {
    expect(slideFromText(text)).toBe(n);
  });

  it.each(["open YouTube", "slide into my DMs", "next", "go to the slideshow"])("%s -> no slide", (text) => {
    expect(slideFromText(text)).toBeNull();
  });

  it("the newest instruction wins, and answers don't change it", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: 'Task from the user: "go to slide 5"\nCurrent screen:' }] },
      { role: "assistant", content: [] },
      { role: "user", content: [{ type: "text", text: 'The user sent a correction: "make it slide 3"' }] },
      { role: "user", content: [{ type: "text", text: 'The user replied: "slide 9 looks nice"' }] },
    ];
    expect(targetSlide(messages)).toBe(3);
  });
});
