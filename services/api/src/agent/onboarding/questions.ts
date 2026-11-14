// The four onboarding questions and how replies are read. Everything is
// multiple choice with "Other" and "Skip", except the first, which is open.
// A reply can be a number ("2"), several ("1, 3"), a word ("forms"),
// "other: taxes", or "skip". Deterministic: no model involved.

import {
  MAX_FREE_TEXT,
  STYLE_CHOICES,
  TASK_CHOICES,
  UPDATE_CHOICES,
  type StyleChoice,
  type TaskChoice,
  type UpdateChoice,
} from "./profile.js";

export type QuestionId = "uses" | "tasks" | "updates" | "style";
export const QUESTION_ORDER: readonly QuestionId[] = ["uses", "tasks", "updates", "style"];

export const QUESTION_TEXT: Record<QuestionId, string> = {
  uses: "What would you like Spectr to help you with? A few words is fine, or reply skip.",
  tasks: `Which of these come up most?
1. Finding files or documents
2. Looking things up online
3. Filling out forms
4. Email or messages
5. Other
Reply with a number, or skip.`,
  updates: `How often should I update you?
1. Every step
2. Every chunk
3. Result
Reply with a number, or skip.`,
  style: `How should I explain things?
1. Keep it short
2. Plain and simple, with each step explained
3. Other
Reply with a number, or skip.`,
};

export const OTHER_PROMPT = "What else? A few words is fine, or reply skip.";

export type Parsed<T> =
  | { kind: "skip" }
  | { kind: "invalid" }
  | { kind: "answer"; value: T }
  /** They picked "Other" without saying what; ask a follow-up. */
  | { kind: "needsOther"; value: T };

const SKIP = /^(skip|pass|no|nope|none|nothing|n\/a|na|later|not now|no thanks)[.!]*$/i;
export const isSkip = (text: string): boolean => SKIP.test(text.trim());

const clip = (text: string): string => text.trim().slice(0, MAX_FREE_TEXT);

/** "2", "1, 3", "1 and 3", "1 & 3". Nothing else counts as a numeric reply. */
const NUMERIC = /^\s*[1-9](?:\s*(?:,|&|\+|and|or|\s)\s*[1-9])*\s*\.?\s*$/i;
function numbersIn(text: string): number[] | null {
  if (!NUMERIC.test(text)) return null;
  return [...new Set([...text.matchAll(/[1-9]/g)].map((m) => Number(m[0])))].sort((a, b) => a - b);
}

const OTHER_WITH_TEXT = /^other\s*[:\-–]\s*(.+)$/i;
const JUST_OTHER = /^other[.!]*$/i;

// --- 1. what they use Spectr for (open-ended) -------------------------------

export function parseUses(raw: string): Parsed<string> {
  const text = raw.trim();
  if (!text || isSkip(text)) return { kind: "skip" };
  return { kind: "answer", value: clip(text) };
}

// --- 2. which tasks (pick several) -------------------------------------------

export interface TasksAnswer {
  tasks: TaskChoice[];
  other: string | null;
}

const TASK_WORDS: Record<TaskChoice, RegExp> = {
  files: /\b(files?|documents?|docs?|folders?)\b/i,
  lookups: /\b(look(ing)?\s*(things\s*)?up|online|search(ing)?|research|web)\b/i,
  forms: /\b(forms?|registration|applications?|paperwork)\b/i,
  messages: /\b(e-?mails?|messages?|texts?|inbox)\b/i,
};

export function parseTasks(raw: string): Parsed<TasksAnswer> {
  const text = raw.trim();
  if (!text || isSkip(text)) return { kind: "skip" };
  const withText = OTHER_WITH_TEXT.exec(text);
  if (withText) return { kind: "answer", value: { tasks: [], other: clip(withText[1]!) } };
  if (JUST_OTHER.test(text)) return { kind: "needsOther", value: { tasks: [], other: null } };

  const nums = numbersIn(text);
  if (nums) {
    const valid = nums.filter((n) => n <= TASK_CHOICES.length + 1);
    if (valid.length === 0) return { kind: "invalid" };
    const tasks = valid.filter((n) => n <= TASK_CHOICES.length).map((n) => TASK_CHOICES[n - 1]!);
    const value = { tasks, other: null };
    return valid.includes(TASK_CHOICES.length + 1) ? { kind: "needsOther", value } : { kind: "answer", value };
  }
  const tasks = TASK_CHOICES.filter((k) => TASK_WORDS[k].test(text));
  // Anything else is their own words.
  return { kind: "answer", value: { tasks, other: tasks.length ? null : clip(text) } };
}

// --- 3. how often to update (one choice) ---------------------------------------

export function parseUpdates(raw: string): Parsed<UpdateChoice> {
  const text = raw.trim();
  if (!text || isSkip(text)) return { kind: "skip" };
  const nums = numbersIn(text);
  if (nums) {
    return nums.length === 1 && nums[0]! <= UPDATE_CHOICES.length
      ? { kind: "answer", value: UPDATE_CHOICES[nums[0]! - 1]! }
      : { kind: "invalid" };
  }
  if (/\b(chunks?|parts?|sections?|stages?|milestones?)\b/i.test(text)) return { kind: "answer", value: "every_chunk" };
  if (/\bsteps?\b/i.test(text)) return { kind: "answer", value: "every_step" };
  if (/\b(results?|final|end|answer|done|finished)\b/i.test(text)) return { kind: "answer", value: "result" };
  return { kind: "invalid" };
}

// --- 4. how to explain things (one choice) ---------------------------------------

export interface StyleAnswer {
  style: StyleChoice | null;
  other: string | null;
}

export function parseStyle(raw: string): Parsed<StyleAnswer> {
  const text = raw.trim();
  if (!text || isSkip(text)) return { kind: "skip" };
  const withText = OTHER_WITH_TEXT.exec(text);
  if (withText) return { kind: "answer", value: { style: null, other: clip(withText[1]!) } };
  if (JUST_OTHER.test(text)) return { kind: "needsOther", value: { style: null, other: null } };

  const nums = numbersIn(text);
  if (nums) {
    if (nums.length !== 1 || nums[0]! > STYLE_CHOICES.length + 1) return { kind: "invalid" };
    const n = nums[0]!;
    return n === STYLE_CHOICES.length + 1
      ? { kind: "needsOther", value: { style: null, other: null } }
      : { kind: "answer", value: { style: STYLE_CHOICES[n - 1]!, other: null } };
  }
  if (/\b(short|brief|quick|concise)\b/i.test(text)) return { kind: "answer", value: { style: "short", other: null } };
  if (/\b(simple|plain|explain\w*|step[- ]by[- ]step|each step|easy)\b/i.test(text)) {
    return { kind: "answer", value: { style: "simple", other: null } };
  }
  return { kind: "answer", value: { style: null, other: clip(text) } };
}
