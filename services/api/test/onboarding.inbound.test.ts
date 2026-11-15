import { describe, expect, it, vi } from "vitest";
import { InMemoryOnboardingStore, InMemoryOnboardingTurnLog } from "../src/agent/onboarding/index.js";
import { handleInboundMessage, type InboundDeps } from "../src/inbound.js";
import { InMemoryTaskStore } from "../src/memory-store.js";

const ANNA = { number: "+15555550100", ownerId: "owner_anna", deviceId: "dev_anna" };
const BEN = { number: "+15555550101", ownerId: "owner_ben", deviceId: "dev_ben" };

function setup() {
  const store = new InMemoryTaskStore();
  const onboarding = { store: new InMemoryOnboardingStore(), turns: new InMemoryOnboardingTurnLog() };
  const sent: { to: string; text: string; key: string }[] = [];
  const deps: InboundDeps = {
    store,
    onboarding,
    provider: "sendblue",
    resolveSender: async (n) => [ANNA, BEN].find((p) => p.number === n) ?? null,
    sendReply: async (to, text, key) => {
      sent.push({ to, text, key });
    },
  };
  let n = 0;
  const text = (who: typeof ANNA, body: string, id = `msg_${++n}`) =>
    handleInboundMessage(
      { providerMessageId: id, fromNumber: who.number, text: body, receivedAt: "2026-11-14T12:00:00.000Z" },
      deps,
    );
  return { store, onboarding, sent, deps, text };
}

describe("onboarding through the inbound handler", () => {
  it("a normal text still becomes a task when the person isn't onboarding", async () => {
    const { store, sent, text } = setup();
    const out = await text(ANNA, "open the demo deck");
    expect(out.status).toBe("created");
    expect(store.tasks.size).toBe(1);
    expect(sent.map((s) => s.text)).toEqual(["Right away."]);
  });

  it("'change my preferences' asks the first question without creating a task", async () => {
    const { store, sent, text } = setup();
    const out = await text(ANNA, "change my preferences");
    expect(out).toEqual({ status: "onboarding" });
    expect(store.tasks.size).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Spectr");
  });

  it("answers walk through the questions, yes saves, and the next text is a task again", async () => {
    const { store, onboarding, text } = setup();
    await text(ANNA, "change my preferences");
    await text(ANNA, "helping with my homework");
    await text(ANNA, "1, 2");
    await text(ANNA, "3");
    await text(ANNA, "1");
    expect(await onboarding.store.getProfile(ANNA.ownerId)).toBeNull();
    const last = await text(ANNA, "yes");
    expect(last).toEqual({ status: "onboarding" });
    expect(await onboarding.store.getProfile(ANNA.ownerId)).toMatchObject({
      uses: "helping with my homework",
      tasks: ["files", "lookups"],
      updates: "result",
      style: "short",
    });
    expect(await onboarding.store.getState(ANNA.ownerId)).toBeNull();

    expect((await text(ANNA, "check my homework deadline")).status).toBe("created");
    expect(store.tasks.size).toBe(1);
  });

  it("a message delivered twice moves the questions forward once and replies once", async () => {
    const { onboarding, sent, text } = setup();
    await text(ANNA, "change my preferences");
    await text(ANNA, "organizing my files", "msg_answer");
    await text(ANNA, "organizing my files", "msg_answer");
    const state = await onboarding.store.getState(ANNA.ownerId);
    expect(state).toMatchObject({ step: "asking", question: "tasks" });
    expect(sent).toHaveLength(2);
  });

  it("'forget that' deletes the profile and any half-finished questions", async () => {
    const { onboarding, text } = setup();
    await onboarding.store.saveProfile(ANNA.ownerId, {
      uses: "email",
      tasks: [],
      tasksOther: null,
      updates: null,
      style: null,
      styleOther: null,
    });
    await text(ANNA, "change my preferences");
    const out = await text(ANNA, "forget that");
    expect(out).toEqual({ status: "onboarding" });
    expect(await onboarding.store.getProfile(ANNA.ownerId)).toBeNull();
    expect(await onboarding.store.getState(ANNA.ownerId)).toBeNull();
  });

  it("'change my preferences' starts from what was saved", async () => {
    const { onboarding, text } = setup();
    await onboarding.store.saveProfile(ANNA.ownerId, {
      uses: "email",
      tasks: ["messages"],
      tasksOther: null,
      updates: "result",
      style: "short",
      styleOther: null,
    });
    await text(ANNA, "change my preferences");
    await text(ANNA, "skip");
    await text(ANNA, "skip");
    await text(ANNA, "skip");
    await text(ANNA, "skip");
    expect(await onboarding.store.getState(ANNA.ownerId)).toMatchObject({
      step: "confirming",
      draft: { uses: "email", updates: "result", style: "short" },
    });
  });

  it("two people's answers and commands never reach each other", async () => {
    const { store, onboarding, sent, text } = setup();
    await text(ANNA, "change my preferences");
    await text(ANNA, "my taxes");
    // Ben isn't onboarding, so his text is a task and Anna's state is untouched.
    expect((await text(BEN, "open the demo deck")).status).toBe("created");
    expect(store.tasks.size).toBe(1);
    expect(await onboarding.store.getState(BEN.ownerId)).toBeNull();
    expect(await onboarding.store.getState(ANNA.ownerId)).toMatchObject({ draft: { uses: "my taxes" } });

    await text(BEN, "change my preferences");
    await text(BEN, "forget that");
    expect(await onboarding.store.getState(ANNA.ownerId)).not.toBeNull();
    expect(sent.filter((s) => s.to === BEN.number).length).toBeGreaterThan(0);
    expect(sent.filter((s) => s.to === ANNA.number).every((s) => !s.text.includes("forgotten"))).toBe(true);
  });

  it("a password typed into an answer is not kept", async () => {
    const { onboarding, text } = setup();
    await text(ANNA, "change my preferences");
    await text(ANNA, "my banking, password is hunter2");
    const state = await onboarding.store.getState(ANNA.ownerId);
    expect(JSON.stringify(state)).not.toContain("hunter2");
  });

  it("unknown senders are still ignored", async () => {
    const { text } = setup();
    const out = await text({ number: "+15555559999", ownerId: "x", deviceId: "y" }, "change my preferences");
    expect(out).toEqual({ status: "ignored", reason: "unknownSender" });
  });

  it("works unchanged when onboarding isn't configured", async () => {
    const { deps } = setup();
    delete deps.onboarding;
    const spy = vi.spyOn(deps.store, "routeInbound");
    await handleInboundMessage(
      { providerMessageId: "m_plain", fromNumber: ANNA.number, text: "change my preferences", receivedAt: "2026-11-14T12:00:00.000Z" },
      deps,
    );
    expect(spy).toHaveBeenCalledOnce();
  });
});
