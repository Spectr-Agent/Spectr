// What the call agent says and does with each finished utterance. Pure functions, so
// every turn is testable without LiveKit, ElevenLabs or a database.
//
// The agent does not plan. A finished utterance is routed into the same inbound
// pipeline the iMessage channel uses (new task, correction, answer or stop), and the
// agent speaks short acknowledgements plus whatever the task loop reports back.

export type InboundKind = "task" | "correction" | "answer" | "stop";
export type TaskState = "accepted" | "running" | "waitingForUser" | "succeeded" | "failed" | "cancelled";

/** How the caller reached Spectr. */
export type CallMedium = "phone" | "facetime" | "app";

/** The task as the agent needs it to narrate progress. */
export interface TaskStatus {
  taskId: string;
  state: TaskState;
  revision: number;
  question: string | null;
  summary: string | null;
}

/**
 * ElevenLabs v3/v4 audio tags: how a line should sound. Only ever spoken, never shown,
 * so every line Spectr says on a call starts with one.
 */
export const MOOD = Object.freeze({
  warm: "[warmly]",
  cheerful: "[cheerfully]",
  calm: "[calmly]",
  curious: "[curious]",
  sorry: "[apologetic]",
} as const);
export type Mood = keyof typeof MOOD;

export function withMood(mood: Mood, text: string): string {
  return `${MOOD[mood]} ${text}`;
}

export type UtteranceAction =
  | { type: "ignore" }
  | { type: "greeting" }
  | { type: "goodbye" }
  | { type: "route"; text: string };

const GREETINGS = new Set(["hi", "hello", "hey", "hey spectr", "hi spectr", "hello spectr", "yo", "are you there"]);
const GOODBYES = new Set(["bye", "goodbye", "bye bye", "hang up", "that's all", "thats all", "thank you bye", "thanks bye"]);

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/u, "")
    .replace(/\s+/gu, " ");
}

/**
 * Decides what to do with a final transcript. Greetings are answered without creating
 * a task when nothing is running; everything else becomes an instruction for the
 * backend (which itself tells corrections, answers and stops apart).
 */
export function utteranceAction(transcript: string, hasActiveTask: boolean): UtteranceAction {
  const text = transcript.trim();
  const words = normalize(text);
  if (words.length < 2) return { type: "ignore" };
  if (GOODBYES.has(words)) return { type: "goodbye" };
  if (!hasActiveTask && GREETINGS.has(words)) return { type: "greeting" };
  return { type: "route", text: text.slice(0, 2_000) };
}

/** Spoken right after an utterance is routed. Short: this is a phone call. */
export function acknowledgement(kind: InboundKind): string {
  switch (kind) {
    case "task":
      return withMood("cheerful", "Right away.");
    case "correction":
      return withMood("calm", "Understood, changing course.");
    case "answer":
      return withMood("warm", "Thank you.");
    case "stop":
      return withMood("calm", "Stopping.");
  }
}

export interface GreetingOptions {
  /** Confirms a number that was linked during this call. */
  justLinked?: boolean;
  /** The caller's first name, when Spectr knows it. */
  name?: string | null;
  /** The task already running for this Mac when the call starts. */
  active?: TaskStatus | null;
  /** The caller's local hour (0-23), for "good morning"; omitted means a plain hello. */
  hour?: number;
}

/** The caller's local hour, or undefined when the time zone is unknown to the runtime. */
export function localHour(timeZone: string | undefined, now = new Date()): number | undefined {
  if (!timeZone) return undefined;
  try {
    const hour = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now);
    return Number(hour) % 24;
  } catch {
    return undefined;
  }
}

function hello(hour: number | undefined, name: string | null | undefined): string {
  const who = name?.trim() ? `, ${name.trim()}` : "";
  if (hour === undefined) return `Hello${who}.`;
  const part = hour < 5 ? "evening" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${part}${who}.`;
}

/**
 * How Spectr opens a call: a greeting, where it is, and whether it is already busy, so
 * the caller knows the state of their Mac before saying anything.
 */
export function greeting(medium: CallMedium, options: GreetingOptions = {}): string {
  const where =
    medium === "facetime"
      ? "Spectr here. You're looking at your Mac, live."
      : medium === "app"
        ? "Spectr here, on your Mac with you."
        : "Spectr here, on your Mac.";
  const active = options.active && !isTerminal(options.active.state) ? options.active : null;
  const status = active
    ? active.state === "waitingForUser" && active.question
      ? `I'm paused on a question for you: ${clip(active.question, 120)}`
      : "I'm still working on your last task. Say stop, or give me something new."
    : "Everything's in order. What may I do for you?";
  const linked = options.justLinked ? "You're all set, this number is now linked to Spectr. " : "";
  return withMood("warm", `${linked}${hello(options.hour, options.name)} ${where} ${status}`);
}

/** When the caller says hello again mid-call. */
export const STILL_HERE = withMood("warm", "Still here. What may I do for you?");

export const NOT_LINKED = withMood(
  "sorry",
  "I'm afraid this number isn't linked to Spectr yet. In the Spectr app, open Setup, add this number, then call again. Goodbye.",
);
export const GOODBYE = withMood("warm", "Very good. Goodbye.");
export const ROUTE_FAILED = withMood("sorry", "I'm afraid I couldn't reach your Mac's task list. Please try again in a moment.");

/**
 * Speakable text is capped so a long summary never becomes a monologue. The default
 * leaves room for a mood tag under the speech client's 300-character limit.
 */
export function clip(text: string, max = 280): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return lastStop > max / 3 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/u, "");
}

/**
 * What to say when the task's status changes, or null when nothing worth saying
 * changed. Success is reported only from the backend's verified final state.
 */
export function narration(previous: TaskStatus | null, next: TaskStatus): string | null {
  const sameTask = previous?.taskId === next.taskId;
  if (sameTask && previous?.state === next.state && previous.revision === next.revision && previous.question === next.question) {
    return null;
  }
  switch (next.state) {
    case "waitingForUser":
      if (next.question && (!sameTask || previous?.question !== next.question)) {
        return withMood("curious", clip(next.question));
      }
      return null;
    case "succeeded":
      if (sameTask && previous?.state === "succeeded") return null;
      return withMood("cheerful", next.summary ? clip(`Done. ${next.summary}`) : "Done.");
    case "failed":
      if (sameTask && previous?.state === "failed") return null;
      return withMood("sorry", next.summary ? clip(`I'm afraid I couldn't finish that. ${next.summary}`) : "I'm afraid I couldn't finish that.");
    case "cancelled":
      if (sameTask && previous?.state === "cancelled") return null;
      return withMood("calm", "Stopped.");
    case "accepted":
    case "running":
      return null;
  }
}

export function isTerminal(state: TaskState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}
