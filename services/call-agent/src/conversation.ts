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
      return withMood("cheerful", "On it.");
    case "correction":
      return withMood("calm", "Got it, changing that.");
    case "answer":
      return withMood("warm", "Thanks.");
    case "stop":
      return withMood("calm", "Stopping.");
  }
}

export function greeting(medium: CallMedium, justLinked = false): string {
  const hello =
    medium === "facetime"
      ? "Hi, this is Spectr. You're looking at your Mac. What should I do?"
      : medium === "app"
        ? "Hi, it's Spectr. I'm on your Mac with you. What should I do?"
        : "Hi, this is Spectr. What should I do on your Mac?";
  return withMood("warm", justLinked ? `You're all set, this number is now linked to Spectr. ${hello}` : hello);
}

export const NOT_LINKED = withMood(
  "sorry",
  "This number isn't linked to Spectr yet. In the Spectr app, open Setup, add this number, then call again. Goodbye.",
);
export const GOODBYE = withMood("warm", "Okay. Bye.");
export const ROUTE_FAILED = withMood("sorry", "Sorry, I couldn't reach your Mac's task list. Try again in a moment.");

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
      return withMood("sorry", next.summary ? clip(`I couldn't finish that. ${next.summary}`) : "I couldn't finish that.");
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
