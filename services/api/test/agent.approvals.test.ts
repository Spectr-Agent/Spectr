// Approval checks for the moments that can't be undone: sending a document to
// someone else, submitting a form and making a purchase. One scenario for each
// of the README's example people, run through the real step loop with a
// scripted Claude and a pretend Mac that records everything it runs.
//
// What this proves: the loop pauses at a question, releases the next step only
// after the owner's reply, never runs anything on its own while waiting, and
// handles yes / no / stop / a change of mind / a repeated message correctly.
// What it can't prove: that real Claude asks at the right moment. The scripted
// Claude does what the script says, so that part needs the live run (see the
// two "known gap" tests at the bottom).

import { describe, expect, it } from "vitest";
import { ask, computer, custom, finish, reply, scriptedClaude, Session } from "./helpers/agent-loop.js";

const scenarios = [
  {
    person: "student: sends a document to a teacher",
    instruction: "email my study notes to Prof. Lee",
    prep: () => custom("prep-1", "open_app", { name: "Mail" }),
    question: "Send study-notes.pdf to Prof. Lee? Reply yes to proceed.",
    commit: () => computer("commit-1", "key", { text: "cmd+shift+d" }),
    done: "The study notes were sent to Prof. Lee.",
    declined: "I did not send the notes.",
    change: "send it to Prof. Kim instead",
    changedQuestion: "Send study-notes.pdf to Prof. Kim? Reply yes to proceed.",
  },
  {
    person: "older person: submits a registration form",
    instruction: "help me complete this registration",
    prep: () => custom("prep-1", "open_url", { url: "https://example.org/register" }),
    question: "Submit the registration form with the details shown? Reply yes to proceed.",
    commit: () => computer("commit-1", "left_click", { coordinate: [60, 70] }),
    done: "The registration form was submitted.",
    declined: "I did not submit the form.",
    change: "wait, use my daughter's email instead",
    changedQuestion: "Submit the form with your daughter's email? Reply yes to proceed.",
  },
  {
    person: "corporate worker: sends a report to a manager",
    instruction: "send the updated chart to my manager",
    prep: () => custom("prep-1", "open_app", { name: "Mail" }),
    question: "Send the updated chart to your manager? Reply yes to proceed.",
    commit: () => computer("commit-1", "key", { text: "cmd+Return" }),
    done: "The updated chart was sent to your manager.",
    declined: "I did not send the chart.",
    change: "also copy the team",
    changedQuestion: "Send the chart to your manager and copy the team? Reply yes to proceed.",
  },
  {
    person: "frequent traveler: pays for a ticket",
    instruction: "buy the e-ticket in my cart",
    prep: () => custom("prep-1", "open_url", { url: "https://tickets.example.com/cart" }),
    question: "Pay for the e-ticket in your cart? Reply yes to proceed.",
    commit: () => computer("commit-1", "left_click", { coordinate: [80, 60] }),
    done: "The e-ticket was paid for.",
    declined: "I did not pay for anything.",
    change: "use the cheaper fare instead",
    changedQuestion: "Pay for the cheaper fare instead? Reply yes to proceed.",
  },
];

describe.each(scenarios)("$person", (s) => {
  it("asks first, names the action, and nothing commits while it waits", async () => {
    const c = scriptedClaude(reply(s.prep()), ask(s.question));
    const session = new Session(c);
    const waiting = await session.start(s.instruction);

    expect(waiting).toMatchObject({ kind: "waiting", question: s.question });
    expect(session.executed).toEqual(["prep-1"]);
    // Waiting again changes nothing and doesn't call Claude.
    expect(await session.advance()).toEqual(waiting);
    expect(c.sent).toHaveLength(2);
    expect(session.violations).toEqual([]);
  });

  it("'yes' releases the commit step, which then finishes", async () => {
    const c = scriptedClaude(reply(s.prep()), ask(s.question), reply(s.commit()), finish(true, s.done));
    const session = new Session(c);
    await session.start(s.instruction);
    await session.say("yes");
    const end = await session.advance();

    expect(session.executed).toEqual(["prep-1", "commit-1"]);
    expect(session.violations).toEqual([]);
    expect(end).toMatchObject({ kind: "finished", state: "succeeded", summary: s.done });
    expect(JSON.stringify(c.sent[2]?.messages.at(-1))).toContain('The user replied: \\"yes\\"');
  });

  it("'no' reaches Claude and nothing is committed", async () => {
    const c = scriptedClaude(reply(s.prep()), ask(s.question), finish(false, s.declined));
    const session = new Session(c);
    await session.start(s.instruction);
    await session.say("no");
    const end = await session.advance();

    expect(JSON.stringify(c.sent[2]?.messages.at(-1))).toContain('The user replied: \\"no\\"');
    expect(session.executed).toEqual(["prep-1"]);
    expect(end).toMatchObject({ kind: "finished", state: "failed", summary: s.declined });
  });

  it("'stop' while it waits cancels the task without another Claude call", async () => {
    const c = scriptedClaude(reply(s.prep()), ask(s.question));
    const session = new Session(c);
    await session.start(s.instruction);
    await session.say("stop");
    const end = await session.advance();

    expect(end).toMatchObject({ kind: "finished", state: "cancelled" });
    expect(c.sent).toHaveLength(2);
    expect(session.executed).toEqual(["prep-1"]);
  });

  it("the same 'yes' delivered twice counts once", async () => {
    const c = scriptedClaude(reply(s.prep()), ask(s.question), reply(s.commit()), finish(true, s.done));
    const session = new Session(c);
    await session.start(s.instruction);
    await session.say("yes", "provider-dup-1");
    await session.say("yes", "provider-dup-1");
    await session.advance();

    const answers = JSON.stringify(c.sent[2]?.messages).match(/The user replied/g) ?? [];
    expect(answers).toHaveLength(1);
    expect(session.executed).toEqual(["prep-1", "commit-1"]);
  });

  it("a change of mind replaces the question, and the old 'yes' doesn't carry over", async () => {
    const c = scriptedClaude(reply(s.prep()), ask(s.question), ask(s.changedQuestion), reply(s.commit()), finish(true, s.done));
    const session = new Session(c);
    await session.start(s.instruction);
    await session.say(s.change);
    const asksAgain = await session.advance();

    expect(asksAgain).toMatchObject({ kind: "waiting", question: s.changedQuestion });
    expect(JSON.stringify(c.sent[2]?.messages.at(-1))).toContain(s.change);
    expect(session.executed).toEqual(["prep-1"]);

    await session.say("yes");
    const end = await session.advance();
    expect(session.executed).toEqual(["prep-1", "commit-1"]);
    expect(session.violations).toEqual([]);
    expect(end).toMatchObject({ kind: "finished", state: "succeeded" });
  });
});

// --- known gaps ------------------------------------------------------------------
// These pass today because they describe how the loop behaves now. If the loop
// later checks approvals in code, they should be flipped to expect the fix.

describe("known gaps (approvals are a prompt rule, not a code check)", () => {
  const s = scenarios[0]!;

  it("the loop does not stop Claude from committing without asking again", async () => {
    // Claude skips the second question after a change of mind and commits straight away.
    const c = scriptedClaude(reply(s.prep()), ask(s.question), reply(s.commit()), finish(true, s.done));
    const session = new Session(c);
    await session.start(s.instruction);
    await session.say(s.change); // not a yes
    await session.advance();

    expect(session.violations).toEqual(["commit-1"]);
  });

  it("a stray 'yes' after the task resumed reaches Claude as a correction, not as an approval", async () => {
    const t = scenarios[3]!;
    const c = scriptedClaude(
      reply(t.prep()),
      ask(t.question),
      reply(t.commit()),
      ask("Use the saved card ending in 4242? Reply yes to proceed."),
    );
    const session = new Session(c);
    await session.start(t.instruction);
    await session.say("yes");
    const paid = await session.stepOnce(); // the payment step is now running on the Mac
    expect(paid.kind).toBe("actions");

    await session.say("yes", "late-duplicate"); // a second, separate "yes" arrives while it runs
    const second = await session.stepOnce();

    expect(second).toMatchObject({ kind: "waiting", question: "Use the saved card ending in 4242? Reply yes to proceed." });
    expect(JSON.stringify(c.sent[3]?.messages.at(-1))).toContain('The user sent a correction: \\"yes\\"');
    // The loop did not treat it as approving the new question: it is still waiting.
    expect(session.executed).toEqual(["prep-1", "commit-1"]);
  });
});
