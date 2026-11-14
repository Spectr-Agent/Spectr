// The onboarding conversation. The backend calls startOnboarding() for a
// newly verified number, then passes that person's replies to
// handleOnboardingReply() until it returns done. A null return means this
// person isn't onboarding, so the message is a normal task.
//
// Nothing is saved until the person says yes. Passwords, codes and card
// numbers are removed from every answer before anything is shown or kept.

import { MAX_FREE_TEXT, ProfileSchema, emptyProfile, hasContent, type Profile } from "./profile.js";
import {
  OTHER_PROMPT,
  QUESTION_ORDER,
  QUESTION_TEXT,
  isSkip,
  parseStyle,
  parseTasks,
  parseUpdates,
  parseUses,
  type Parsed,
  type QuestionId,
} from "./questions.js";
import { redactSecrets } from "./redact.js";
import type { OnboardingState, OnboardingStore } from "./store.js";

export interface OnboardingDeps {
  store: OnboardingStore;
}

export interface Turn {
  /** The text to send back. */
  say: string;
  /** True when onboarding has ended (saved or not). */
  done: boolean;
  /** Set only when the person said yes and the profile was saved. */
  saved?: Profile;
}

export const MESSAGES = {
  intro: "Hello, I'm Spectr. A few quick questions will help me work the way you like. Reply skip to pass on any of them.",
  update: "Certainly. Let's update what I remember.",
  redacted: "I left out something that looked like a password or code. I never keep those.",
  invalid: "I'm afraid I didn't catch that.",
  saved: "Thank you. I'll remember that.",
  discarded: "Understood. I won't keep anything.",
  nothing: "No problem. I won't keep anything. Text \"change my preferences\" whenever you like.",
  changeMenu: `Which would you like to change?
1. What you use Spectr for
2. Which tasks come up
3. How often I update you
4. How I explain things
Reply with a number, or "never mind".`,
} as const;

const YES = /^(yes|y|yeah|yep|yup|sure|ok|okay|correct|that'?s right|please do|go ahead)[.!]*$/i;
const NO = /^(no|n|nope|nah|never mind|don'?t|do not)[.!]*$/i;
const CANCEL = /^(never mind|cancel|back|nothing)[.!]*$/i;

// --- summary ---------------------------------------------------------------------

const TASK_LABEL = {
  files: "finding files",
  lookups: "looking things up online",
  forms: "filling out forms",
  messages: "email and messages",
} as const;

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function summarize(p: Profile): string {
  const clauses: string[] = [];
  if (p.uses) clauses.push(`you use Spectr for ${p.uses}`);
  const tasks = [...p.tasks.map((t) => TASK_LABEL[t]), ...(p.tasksOther ? [p.tasksOther] : [])];
  if (tasks.length) clauses.push(`you'd like help with ${joinList(tasks)}`);
  if (p.updates) {
    clauses.push(
      p.updates === "every_step"
        ? "you'd like an update after every step"
        : p.updates === "every_chunk"
          ? "you'd like an update after each part of a task"
          : "you'd like only the final result",
    );
  }
  if (p.style === "short") clauses.push("you prefer short replies");
  else if (p.style === "simple") clauses.push("you prefer plain, simple replies that explain each step");
  else if (p.styleOther) clauses.push(`you'd like me to explain things this way: ${p.styleOther}`);
  return `Here's what I'll remember: ${joinList(clauses)}. Shall I remember this? Reply yes, no, or tell me what to change.`;
}

// --- helpers ---------------------------------------------------------------------------

function ask(question: QuestionId, prefix = ""): string {
  return `${prefix}${QUESTION_TEXT[question]}`;
}

function nextQuestion(current: QuestionId): QuestionId | null {
  return QUESTION_ORDER[QUESTION_ORDER.indexOf(current) + 1] ?? null;
}

function withNote(note: string, say: string): string {
  return note ? `${note} ${say}` : say;
}

async function goToConfirm(identity: string, draft: Profile, deps: OnboardingDeps, note: string): Promise<Turn> {
  if (!hasContent(draft)) {
    await deps.store.deleteState(identity);
    return { say: withNote(note, MESSAGES.nothing), done: true };
  }
  await deps.store.putState(identity, { step: "confirming", draft });
  return { say: withNote(note, summarize(draft)), done: false };
}

async function advance(
  identity: string,
  state: Extract<OnboardingState, { step: "asking" }>,
  draft: Profile,
  deps: OnboardingDeps,
  note: string,
): Promise<Turn> {
  const next = state.returnToConfirm ? null : nextQuestion(state.question);
  if (!next) return goToConfirm(identity, draft, deps, note);
  await deps.store.putState(identity, { step: "asking", question: next, draft, awaitingOther: false, returnToConfirm: false });
  return { say: ask(next, note ? `${note}\n\n` : ""), done: false };
}

// --- public API -----------------------------------------------------------------------------

/** Begin (or restart, for "change my preferences") and return the first question. */
export async function startOnboarding(identity: string, deps: OnboardingDeps, existing?: Profile | null): Promise<Turn> {
  const draft = existing ? ProfileSchema.parse(existing) : emptyProfile();
  await deps.store.putState(identity, { step: "asking", question: "uses", draft, awaitingOther: false, returnToConfirm: false });
  return { say: `${existing ? MESSAGES.update : MESSAGES.intro}\n\n${QUESTION_TEXT.uses}`, done: false };
}

/** Handle one reply. Returns null if this person isn't onboarding. */
export async function handleOnboardingReply(identity: string, raw: string, deps: OnboardingDeps): Promise<Turn | null> {
  const state = await deps.store.getState(identity);
  if (!state) return null;

  const { text, removed } = redactSecrets(raw);
  const note = removed ? MESSAGES.redacted : "";

  if (state.step === "asking") return handleAnswer(identity, state, text, deps, note);
  if (state.step === "changing") return handleChoice(identity, state, text, deps, note);
  return handleConfirm(identity, state, text, deps, note);
}

type Applied = { kind: "invalid" | "skip" } | { kind: "ok" | "needsOther"; draft: Profile };

/** Read a reply for one question and fold it into the draft. Each question's types stay checked. */
function applyReply(q: QuestionId, text: string, draft: Profile): Applied {
  switch (q) {
    case "uses":
      return fold(parseUses(text), draft, (d, uses) => ({ ...d, uses }));
    case "tasks":
      return fold(parseTasks(text), draft, (d, v) => ({ ...d, tasks: v.tasks, tasksOther: v.other }));
    case "updates":
      return fold(parseUpdates(text), draft, (d, updates) => ({ ...d, updates }));
    case "style":
      return fold(parseStyle(text), draft, (d, v) => ({ ...d, style: v.style, styleOther: v.other }));
  }
}

function fold<T>(parsed: Parsed<T>, draft: Profile, set: (draft: Profile, value: T) => Profile): Applied {
  if (parsed.kind === "skip" || parsed.kind === "invalid") return { kind: parsed.kind };
  return { kind: parsed.kind === "answer" ? "ok" : "needsOther", draft: set(draft, parsed.value) };
}

async function handleAnswer(
  identity: string,
  state: Extract<OnboardingState, { step: "asking" }>,
  text: string,
  deps: OnboardingDeps,
  note: string,
): Promise<Turn> {
  const q = state.question;

  // They picked "Other" earlier; this reply says what.
  if (state.awaitingOther) {
    const other = text && !isSkip(text) ? text.slice(0, MAX_FREE_TEXT) : null;
    const draft = !other ? state.draft : q === "tasks" ? { ...state.draft, tasksOther: other } : { ...state.draft, styleOther: other };
    return advance(identity, state, draft, deps, note);
  }

  const applied = applyReply(q, text, state.draft);
  if (applied.kind === "invalid") {
    const hint = q === "updates" ? "Please reply 1, 2, 3 or skip." : "Please reply with a number or skip.";
    return { say: `${withNote(note, MESSAGES.invalid)} ${hint}\n\n${QUESTION_TEXT[q]}`, done: false };
  }
  if (applied.kind === "needsOther") {
    await deps.store.putState(identity, { ...state, draft: applied.draft, awaitingOther: true });
    return { say: withNote(note, OTHER_PROMPT), done: false };
  }
  return advance(identity, state, applied.kind === "ok" ? applied.draft : state.draft, deps, note);
}

async function handleConfirm(
  identity: string,
  state: Extract<OnboardingState, { step: "confirming" }>,
  text: string,
  deps: OnboardingDeps,
  note: string,
): Promise<Turn> {
  if (YES.test(text)) {
    await deps.store.saveProfile(identity, state.draft);
    await deps.store.deleteState(identity);
    return { say: withNote(note, MESSAGES.saved), done: true, saved: state.draft };
  }
  if (NO.test(text)) {
    await deps.store.deleteState(identity);
    return { say: withNote(note, MESSAGES.discarded), done: true };
  }

  // Anything else is a request to change something: show the menu.
  await deps.store.putState(identity, { step: "changing", draft: state.draft });
  return { say: withNote(note, MESSAGES.changeMenu), done: false };
}

async function handleChoice(
  identity: string,
  state: Extract<OnboardingState, { step: "changing" }>,
  text: string,
  deps: OnboardingDeps,
  note: string,
): Promise<Turn> {
  if (CANCEL.test(text)) return goToConfirm(identity, state.draft, deps, note);
  const n = /^\s*([1-4])\s*\.?\s*$/.exec(text)?.[1];
  if (!n) return { say: `${withNote(note, MESSAGES.invalid)} ${MESSAGES.changeMenu}`, done: false };
  const question = QUESTION_ORDER[Number(n) - 1]!;
  await deps.store.putState(identity, { step: "asking", question, draft: state.draft, awaitingOther: false, returnToConfirm: true });
  return { say: ask(question, note ? `${note}\n\n` : ""), done: false };
}
