import { describe, expect, it } from "vitest";
import {
  InMemoryOnboardingStore,
  MESSAGES,
  emptyProfile,
  handleOnboardingReply,
  parseStyle,
  parseTasks,
  parseUpdates,
  parseUses,
  redactSecrets,
  startOnboarding,
  summarize,
  type OnboardingDeps,
  type Profile,
  type Turn,
} from "../src/agent/onboarding/index.js";

// --- helpers ---------------------------------------------------------------------

const PHONE = "+15555550101";

function setup() {
  const store = new InMemoryOnboardingStore();
  const deps: OnboardingDeps = { store };
  const said: string[] = [];
  return {
    store,
    deps,
    said,
    async start(identity = PHONE, existing?: Profile | null): Promise<Turn> {
      const turn = await startOnboarding(identity, deps, existing);
      said.push(turn.say);
      return turn;
    },
    async reply(text: string, identity = PHONE): Promise<Turn> {
      const turn = await handleOnboardingReply(identity, text, deps);
      expect(turn, `no onboarding turn for "${text}"`).not.toBeNull();
      said.push(turn!.say);
      return turn!;
    },
  };
}

/** Run a whole chat and return the final turn. */
async function chat(replies: string[]) {
  const s = setup();
  await s.start();
  let last!: Turn;
  for (const r of replies) last = await s.reply(r);
  return { ...s, last };
}

// --- reading replies --------------------------------------------------------------

describe("reading replies", () => {
  it("what they use Spectr for: free text or skip", () => {
    expect(parseUses("help with school and email")).toEqual({ kind: "answer", value: "help with school and email" });
    for (const s of ["skip", "Skip.", "pass", "no", "none", "later", ""]) expect(parseUses(s)).toEqual({ kind: "skip" });
  });

  it("tasks: numbers, several numbers, words, other, skip", () => {
    expect(parseTasks("2")).toEqual({ kind: "answer", value: { tasks: ["lookups"], other: null } });
    expect(parseTasks("1, 3")).toEqual({ kind: "answer", value: { tasks: ["files", "forms"], other: null } });
    expect(parseTasks("1 and 4")).toEqual({ kind: "answer", value: { tasks: ["files", "messages"], other: null } });
    expect(parseTasks("filling out forms")).toEqual({ kind: "answer", value: { tasks: ["forms"], other: null } });
    expect(parseTasks("5")).toEqual({ kind: "needsOther", value: { tasks: [], other: null } });
    expect(parseTasks("2, 5")).toEqual({ kind: "needsOther", value: { tasks: ["lookups"], other: null } });
    expect(parseTasks("other")).toEqual({ kind: "needsOther", value: { tasks: [], other: null } });
    expect(parseTasks("other: taxes")).toEqual({ kind: "answer", value: { tasks: [], other: "taxes" } });
    expect(parseTasks("managing my calendar")).toEqual({ kind: "answer", value: { tasks: [], other: "managing my calendar" } });
    expect(parseTasks("skip")).toEqual({ kind: "skip" });
    expect(parseTasks("9")).toEqual({ kind: "invalid" });
  });

  it("updates: Every step, Every chunk, Result", () => {
    expect(parseUpdates("1")).toEqual({ kind: "answer", value: "every_step" });
    expect(parseUpdates("2.")).toEqual({ kind: "answer", value: "every_chunk" });
    expect(parseUpdates("3")).toEqual({ kind: "answer", value: "result" });
    expect(parseUpdates("every step please")).toEqual({ kind: "answer", value: "every_step" });
    expect(parseUpdates("every chunk")).toEqual({ kind: "answer", value: "every_chunk" });
    expect(parseUpdates("just the result")).toEqual({ kind: "answer", value: "result" });
    expect(parseUpdates("skip")).toEqual({ kind: "skip" });
    for (const bad of ["4", "1, 2", "maybe", "a lot"]) expect(parseUpdates(bad)).toEqual({ kind: "invalid" });
  });

  it("style: short, simple, other, own words", () => {
    expect(parseStyle("1")).toEqual({ kind: "answer", value: { style: "short", other: null } });
    expect(parseStyle("2")).toEqual({ kind: "answer", value: { style: "simple", other: null } });
    expect(parseStyle("3")).toEqual({ kind: "needsOther", value: { style: null, other: null } });
    expect(parseStyle("explain each step")).toEqual({ kind: "answer", value: { style: "simple", other: null } });
    expect(parseStyle("other: larger text")).toEqual({ kind: "answer", value: { style: null, other: "larger text" } });
    expect(parseStyle("I need larger text")).toEqual({ kind: "answer", value: { style: null, other: "I need larger text" } });
    expect(parseStyle("skip")).toEqual({ kind: "skip" });
    expect(parseStyle("7")).toEqual({ kind: "invalid" });
  });
});

// --- privacy --------------------------------------------------------------------------

describe("secrets", () => {
  it.each([
    ["my password is hunter2", "my"],
    ["use card 4111 1111 1111 1111 for it", "use card for it"],
    ["the code is 482913", "the code is"],
    ["otp: 123456 thanks", "thanks"],
    ["my pin 4821", "my"],
    ["passcode hunter2!", ""],
  ])("removes secrets from %j", (input, expected) => {
    const r = redactSecrets(input);
    expect(r.removed).toBe(true);
    expect(r.text).toBe(expected);
  });

  it.each(["I write code for school", "help with my password manager", "call me at 5pm", "order 66 pencils"])(
    "leaves ordinary text alone: %j",
    (input) => {
      expect(redactSecrets(input)).toEqual({ text: input, removed: false });
    },
  );

  it("never shows back or saves a password typed into an answer", async () => {
    const c = await chat(["I do homework, my password is hunter2", "skip", "skip", "skip", "yes"]);
    const saved = await c.store.getProfile(PHONE);
    expect(saved?.uses).toBe("I do homework, my");
    expect(JSON.stringify([saved, c.said])).not.toContain("hunter2");
    expect(c.said.some((m) => m.startsWith(MESSAGES.redacted))).toBe(true);
  });

  it("a card number in an 'Other' answer is dropped", async () => {
    const c = await chat(["skip", "5", "paying bills with 4111 1111 1111 1111", "skip", "skip", "yes"]);
    const saved = await c.store.getProfile(PHONE);
    expect(saved?.tasksOther).toBe("paying bills with");
    expect(JSON.stringify(c.said)).not.toContain("4111");
  });

  it("an answer that is only a secret counts as skipped", async () => {
    const c = await chat(["482913"]);
    const profile = (await c.store.getState(PHONE))!.draft;
    expect(profile.uses).toBeNull();
  });
});

// --- the four example people ----------------------------------------------------------

describe("onboarding chats for the four example people", () => {
  it("student: school, files and lookups, result only, short replies", async () => {
    const c = await chat(["school and email", "1, 2", "3", "1"]);
    expect(c.last.say).toBe(
      "Here's what I'll remember: you use Spectr for school and email, you'd like help with finding files and looking things up online, you'd like only the final result and you prefer short replies. Shall I remember this? Reply yes, no, or tell me what to change.",
    );
    const done = await handleOnboardingReply(PHONE, "yes", c.deps);
    expect(done).toMatchObject({ done: true, say: MESSAGES.saved });
    expect(await c.store.getProfile(PHONE)).toEqual({
      uses: "school and email",
      tasks: ["files", "lookups"],
      tasksOther: null,
      updates: "result",
      style: "short",
      styleOther: null,
    });
    expect(await c.store.getState(PHONE)).toBeNull();
  });

  it("older person with an accessibility need: forms, every step, plain and simple", async () => {
    const c = await chat(["websites are hard for me", "3", "1", "2"]);
    expect(c.last.say).toContain("you'd like an update after every step");
    expect(c.last.say).toContain("you prefer plain, simple replies that explain each step");
    await handleOnboardingReply(PHONE, "yes", c.deps);
    expect(await c.store.getProfile(PHONE)).toMatchObject({ tasks: ["forms"], updates: "every_step", style: "simple" });
  });

  it("corporate worker: reports and email, every chunk, skips the style question", async () => {
    const c = await chat(["reports and email", "1, 4", "2", "skip"]);
    expect(c.last.say).toContain("finding files and email and messages");
    expect(c.last.say).toContain("an update after each part of a task");
    expect(c.last.say).not.toContain("prefer");
    await handleOnboardingReply(PHONE, "yes", c.deps);
    expect(await c.store.getProfile(PHONE)).toMatchObject({ updates: "every_chunk", style: null });
  });

  it("frequent traveler: files while away, result, picks Other for style", async () => {
    const c = await chat(["files while I'm away", "1", "3", "3", "send a screenshot of the result"]);
    expect(c.last.say).toContain("explain things this way: send a screenshot of the result");
    await handleOnboardingReply(PHONE, "yes", c.deps);
    expect(await c.store.getProfile(PHONE)).toMatchObject({ styleOther: "send a screenshot of the result", style: null });
  });
});

// --- skipping, declining and changing ---------------------------------------------------

describe("skipping, saying no and changing answers", () => {
  it("skipping everything saves nothing and ends cleanly", async () => {
    const c = await chat(["skip", "skip", "skip", "skip"]);
    expect(c.last).toEqual({ say: MESSAGES.nothing, done: true });
    expect(await c.store.getProfile(PHONE)).toBeNull();
    expect(await c.store.getState(PHONE)).toBeNull();
  });

  it("a partial chat only keeps what was answered", async () => {
    const c = await chat(["skip", "skip", "1", "skip", "yes"]);
    expect(await c.store.getProfile(PHONE)).toEqual({ ...emptyProfile(), updates: "every_step" });
  });

  it("'no' to remembering saves nothing", async () => {
    const c = await chat(["school", "1", "3", "1", "no"]);
    expect(c.last).toEqual({ say: MESSAGES.discarded, done: true });
    expect(await c.store.getProfile(PHONE)).toBeNull();
    expect(await c.store.getState(PHONE)).toBeNull();
  });

  it("nothing is saved until the person says yes", async () => {
    const c = await chat(["school", "1", "3", "1"]);
    expect(await c.store.getProfile(PHONE)).toBeNull();
  });

  it("changing an answer by number re-asks that question, then confirms again", async () => {
    const c = await chat(["school", "1", "3", "1"]);
    const menu = await c.reply("actually can I change something");
    expect(menu.say).toBe(MESSAGES.changeMenu);
    const reask = await c.reply("3");
    expect(reask.say).toContain("How often should I update you?");
    const confirm = await c.reply("1");
    expect(confirm.say).toContain("an update after every step");
    expect(confirm.say).not.toContain("only the final result");
    await c.reply("yes");
    expect(await c.store.getProfile(PHONE)).toMatchObject({ updates: "every_step", style: "short", uses: "school" });
  });

  it("a change request in the person's own words gets the menu", async () => {
    const c = await chat(["school", "1", "3", "1", "make it every step instead"]);
    expect(c.last.say).toBe(MESSAGES.changeMenu);
  });

  it("'never mind' at the change menu goes back to the summary", async () => {
    const c = await chat(["school", "1", "3", "1", "hmm", "never mind"]);
    expect(c.last.say).toContain("Shall I remember this?");
  });

  it("changing by number can use Other", async () => {
    const c = await chat(["school", "1", "3", "1", "change", "4", "3", "larger text"]);
    expect(c.last.say).toContain("explain things this way: larger text");
    expect(c.last.say).not.toContain("short replies");
  });

});

// --- asking again, bad replies, restarts -----------------------------------------------------

describe("the conversation itself", () => {
  it("asks 'Other' a follow-up and takes skip as an answer", async () => {
    const s = setup();
    await s.start();
    await s.reply("skip");
    expect((await s.reply("5")).say).toBe("What else? A few words is fine, or reply skip.");
    expect((await s.reply("skip")).say).toContain("How often should I update you?");
    expect((await s.store.getState(PHONE))!.step).toBe("asking");
  });

  it("re-asks the same question on a reply it can't read", async () => {
    const s = setup();
    await s.start();
    await s.reply("skip");
    await s.reply("skip");
    const again = await s.reply("whenever");
    expect(again.say).toContain("I'm afraid I didn't catch that. Please reply 1, 2, 3 or skip.");
    expect(again.say).toContain("How often should I update you?");
    expect((await s.reply("2")).say).toContain("How should I explain things?");
  });

  it("returns null for someone who isn't onboarding", async () => {
    const s = setup();
    expect(await handleOnboardingReply(PHONE, "open Safari", s.deps)).toBeNull();
    await s.start();
    await s.reply("skip");
    await s.reply("skip");
    await s.reply("skip");
    await s.reply("skip");
    expect(await handleOnboardingReply(PHONE, "open Safari", s.deps)).toBeNull();
  });

  it("'change my preferences' starts again, with the earlier answers kept until replaced", async () => {
    const first = await chat(["school", "1", "3", "1", "yes"]);
    const saved = (await first.store.getProfile(PHONE))!;
    const turn = await startOnboarding(PHONE, first.deps, saved);
    expect(turn.say).toContain(MESSAGES.update);
    await handleOnboardingReply(PHONE, "skip", first.deps); // keep "uses"
    await handleOnboardingReply(PHONE, "skip", first.deps);
    await handleOnboardingReply(PHONE, "1", first.deps);
    await handleOnboardingReply(PHONE, "skip", first.deps);
    const finish = await handleOnboardingReply(PHONE, "yes", first.deps);
    expect(finish?.saved).toMatchObject({ uses: "school", updates: "every_step", style: "short" });
  });

  it("one person's answers never reach another's", async () => {
    const s = setup();
    const OTHER = "+15555550102";
    await s.start(PHONE);
    await s.start(OTHER);
    await s.reply("school", PHONE);
    await s.reply("accounting", OTHER);
    for (const [id, answer] of [[PHONE, "1"], [OTHER, "3"]] as const) {
      await s.reply(answer, id);
      await s.reply("skip", id);
      await s.reply("skip", id);
      await s.reply("yes", id);
    }
    expect(await s.store.getProfile(PHONE)).toMatchObject({ uses: "school", tasks: ["files"] });
    expect(await s.store.getProfile(OTHER)).toMatchObject({ uses: "accounting", tasks: ["forms"] });
    expect(JSON.stringify(await s.store.getProfile(PHONE))).not.toContain("accounting");
  });

  it("every message sounds calm and fits in a text", async () => {
    const c = await chat(["school", "1, 3", "2", "2", "change", "never mind", "yes"]);
    for (const message of c.said) {
      expect(message.length).toBeLessThanOrEqual(400);
      expect(message).not.toMatch(/!|oops|absolutely|happy to/i);
      expect(message).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("summarize reads naturally with one, two or many items", () => {
    expect(summarize({ ...emptyProfile(), updates: "result" })).toContain("Here's what I'll remember: you'd like only the final result.");
    expect(summarize({ ...emptyProfile(), tasks: ["files", "forms", "messages"], tasksOther: "taxes" })).toContain(
      "finding files, filling out forms, email and messages and taxes",
    );
  });
});
