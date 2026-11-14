// Example payloads for Jared's Mac helper and iPhone app: one of every action,
// plus the guardrail moments (confirm, login, stop, honest failure). Each case
// carries the status line the app should show. test/agent.status.test.ts checks
// every payload against contracts.ts and writes fixtures/guardrail-cases.json.

import type { MacAction, MacStepResponse } from "../contracts.js";
import { REFUSAL_SUMMARY } from "./step.js";
import { slideMismatchSummary } from "./slides.js";
import { status, statusForAction, statusForResponse } from "./status.js";

const TASK = "tsk_demo_001";

/** One example of every action the Mac helper must run. */
export const EXAMPLE_ACTIONS: ReadonlyArray<{ name: string; action: MacAction }> = [
  { name: "screenshot", action: { type: "screenshot" } },
  { name: "click", action: { type: "click", x: 420, y: 340, button: "left", clicks: 1, modifiers: [] } },
  { name: "double-click", action: { type: "click", x: 420, y: 340, button: "left", clicks: 2, modifiers: [] } },
  { name: "right-click", action: { type: "click", x: 420, y: 340, button: "right", clicks: 1, modifiers: [] } },
  { name: "move", action: { type: "mouseMove", x: 600, y: 120 } },
  { name: "drag", action: { type: "drag", fromX: 100, fromY: 200, toX: 500, toY: 200, modifiers: [] } },
  { name: "scroll", action: { type: "scroll", x: 640, y: 400, direction: "down", amount: 3, modifiers: [] } },
  { name: "type", action: { type: "type", text: "running late, be there at 7" } },
  { name: "hotkey", action: { type: "key", keys: "cmd+l", repeat: 1 } },
  { name: "key repeat", action: { type: "key", keys: "tab", repeat: 3 } },
  { name: "wait", action: { type: "wait", seconds: 2 } },
  { name: "open app", action: { type: "openApp", name: "Messages" } },
  { name: "open url", action: { type: "openUrl", url: "https://www.instagram.com/direct/inbox/" } },
];

/** The moments the app must handle clearly. */
export const GUARDRAIL_CASES: ReadonlyArray<{ name: string; note: string; response: MacStepResponse }> = [
  {
    name: "confirm before sending",
    note: "Claude asks before sending, posting, buying, submitting or deleting. The Mac does nothing until the owner replies yes.",
    response: { kind: "waiting", taskId: TASK, step: 4, question: status("confirm", { action: "Send \"running late\" to Sam in Messages?" }) },
  },
  {
    name: "login pause",
    note: "Spectr never types passwords or 2FA codes. The owner logs in on the Mac while watching live, then replies done.",
    response: { kind: "waiting", taskId: TASK, step: 2, question: `Instagram wants you to log in. ${status("login")}` },
  },
  {
    name: "unclear request",
    note: "Claude asks one short question instead of guessing.",
    response: { kind: "waiting", taskId: TASK, step: 1, question: "Which app or website do you mean?" },
  },
  {
    name: "done",
    note: "Only reported when the final screenshot shows the result.",
    response: { kind: "finished", taskId: TASK, step: 6, state: "succeeded", summary: "Your Instagram DMs are open." },
  },
  {
    name: "failed honestly",
    note: "The final screen doesn't show the goal, so Spectr says what it saw.",
    response: { kind: "finished", taskId: TASK, step: 5, state: "failed", summary: "I couldn't find that restaurant." },
  },
  {
    name: "wrong slide",
    note: "Keynote example: the Mac reported a different slide than asked.",
    response: { kind: "finished", taskId: TASK, step: 3, state: "failed", summary: slideMismatchSummary(5, 3) },
  },
  {
    name: "declined",
    note: "Claude's safety filter declined the task.",
    response: { kind: "finished", taskId: TASK, step: 1, state: "failed", summary: REFUSAL_SUMMARY },
  },
  {
    name: "stopped",
    note: "The owner said stop. Pending steps are dropped.",
    response: { kind: "finished", taskId: TASK, step: 3, state: "cancelled", summary: "Stopped by the user." },
  },
];

export function exportHandoffCases() {
  return {
    actions: EXAMPLE_ACTIONS.map(({ name, action }) => ({ name, action, status: statusForAction(action) })),
    responses: GUARDRAIL_CASES.map(({ name, note, response }) => ({ name, note, response, status: statusForResponse(response) })),
  };
}
