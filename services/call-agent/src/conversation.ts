// What the call agent says and does with each finished utterance. Pure functions, so
// every turn is testable without LiveKit, ElevenLabs or a database.
//
// The agent does not plan. A finished utterance is routed into the same inbound
// pipeline the iMessage channel uses (new task, correction, answer or stop), and the
// agent speaks short acknowledgements plus whatever the task loop reports back.
//
// Every fixed line comes in several wordings. A `Phrasing` picks one at random and never
// repeats the previous pick for the same line, so a call doesn't sound like a recording.

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

/**
 * Chooses among wordings of the same line. One per call: it remembers the last pick for
 * each line so the same words are never heard twice in a row. `random` is injectable so
 * tests are deterministic.
 */
export class Phrasing {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly random: () => number = Math.random,
    private readonly vary = true,
  ) {}

  pick(key: string, options: readonly string[]): string {
    if (options.length === 0) throw new Error(`No wordings for "${key}"`);
    if (options.length === 1 || !this.vary) return options[0] as string;
    const previous = this.last.get(key);
    let index = Math.min(options.length - 1, Math.floor(this.random() * options.length));
    if (index === previous) index = (index + 1) % options.length;
    this.last.set(key, index);
    return options[index] as string;
  }
}

/** Always the first wording, with no memory: for callers that don't care about variety, and for tests. */
export const FIRST_WORDING = new Phrasing(() => 0, false);

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

const STOP_WORDS = /^(stop|stop it|stop that|stop now|please stop|cancel|cancel that|cancel it|never mind|nevermind|forget it|abort|halt)( spectr)?$/u;

/**
 * The backend decides what an utterance is, but the caller shouldn't wait for a round
 * trip to hear anything. This guesses the kind from what the call already knows, so a
 * fitting acknowledgement can be spoken at once; the backend's answer wins afterwards.
 */
export function likelyKind(text: string, active: TaskStatus | null): InboundKind {
  if (STOP_WORDS.test(normalize(text))) return "stop";
  if (!active || isTerminal(active.state)) return "task";
  return active.state === "waitingForUser" ? "answer" : "correction";
}

const ACKNOWLEDGEMENTS: Readonly<Record<InboundKind, readonly string[]>> = Object.freeze({
  task: [
    withMood("cheerful", "Right away."),
    withMood("cheerful", "Certainly."),
    withMood("cheerful", "On it."),
    withMood("cheerful", "Consider it done."),
    withMood("calm", "Very good. One moment."),
    withMood("cheerful", "Leave it with me."),
  ],
  correction: [
    withMood("calm", "Understood, changing course."),
    withMood("calm", "Noted. Adjusting now."),
    withMood("calm", "Very well, I'll change tack."),
    withMood("calm", "Understood. I'll take it from there."),
  ],
  answer: [
    withMood("warm", "Thank you."),
    withMood("warm", "Noted, thank you."),
    withMood("warm", "Very good, carrying on."),
    withMood("warm", "Much obliged. Continuing."),
  ],
  stop: [
    withMood("calm", "Stopping."),
    withMood("calm", "Stopping now."),
    withMood("calm", "Very well, I'll stop there."),
    withMood("calm", "Understood. Standing down."),
  ],
});

/** Spoken right after an utterance is routed. Short: this is a phone call. */
export function acknowledgement(kind: InboundKind, phrasing: Phrasing = FIRST_WORDING): string {
  return phrasing.pick(`ack:${kind}`, ACKNOWLEDGEMENTS[kind]);
}

/** When the backend saw the utterance differently from the guess spoken at once. */
export function afterthought(guessed: InboundKind, actual: InboundKind, phrasing: Phrasing = FIRST_WORDING): string | null {
  if (guessed === actual) return null;
  switch (actual) {
    case "stop":
      return phrasing.pick("after:stop", [
        withMood("calm", "Stopping, then."),
        withMood("calm", "Very well, stopping."),
      ]);
    case "correction":
      return phrasing.pick("after:correction", [
        withMood("calm", "Changing course."),
        withMood("calm", "Adjusting."),
      ]);
    case "answer":
    case "task":
      return null;
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

function hello(hour: number | undefined, name: string | null | undefined, phrasing: Phrasing): string {
  const who = name?.trim() ? `, ${name.trim()}` : "";
  if (hour === undefined) return phrasing.pick("hello", [`Hello${who}.`, `Good to hear from you${who}.`, `Hello there${who}.`]);
  const part = hour < 5 ? "evening" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return phrasing.pick(`hello:${part}`, [
    `Good ${part}${who}.`,
    `Good ${part}${who}. Good to hear from you.`,
    `${part[0]?.toUpperCase()}${part.slice(1)}${who}.`,
  ]);
}

const WHERE: Readonly<Record<CallMedium, readonly string[]>> = Object.freeze({
  facetime: [
    "Spectr here. You're looking at your Mac, live.",
    "Spectr here, with your Mac on screen.",
    "Spectr here. That's your Mac you're seeing, live.",
  ],
  app: [
    "Spectr here, on your Mac with you.",
    "Spectr here, at your Mac.",
    "Spectr here, right here on your Mac.",
  ],
  phone: ["Spectr here, on your Mac.", "Spectr here, at your Mac.", "Spectr here, standing by at your Mac."],
});

const ALL_QUIET: readonly string[] = [
  "Everything's in order. What may I do for you?",
  "All quiet here. What can I do for you?",
  "Nothing's running at the moment. What shall I take care of?",
  "Everything's in order. How may I help?",
  "All's well here. What would you like done?",
];

const STILL_BUSY: readonly string[] = [
  "I'm still working on your last task. Say stop, or give me something new.",
  "Your last task is still under way. Say stop, or tell me what's next.",
  "I'm still on your last request. Say stop, or let me know what else you need.",
];

const PAUSED_ON: readonly string[] = ["I'm paused on a question for you:", "I'm waiting on one thing from you:", "I have a question before I carry on:"];

const LINKED: readonly string[] = [
  "You're all set, this number is now linked to Spectr.",
  "This number is now linked to Spectr. You're all set.",
];

/**
 * How Spectr opens a call: a greeting, where it is, and whether it is already busy, so
 * the caller knows the state of their Mac before saying anything.
 */
export function greeting(medium: CallMedium, options: GreetingOptions = {}, phrasing: Phrasing = FIRST_WORDING): string {
  const where = phrasing.pick(`where:${medium}`, WHERE[medium]);
  const active = options.active && !isTerminal(options.active.state) ? options.active : null;
  const status = active
    ? active.state === "waitingForUser" && active.question
      ? `${phrasing.pick("paused", PAUSED_ON)} ${clip(active.question, 120)}`
      : phrasing.pick("busy", STILL_BUSY)
    : phrasing.pick("quiet", ALL_QUIET);
  const linked = options.justLinked ? `${phrasing.pick("linked", LINKED)} ` : "";
  return withMood("warm", `${linked}${hello(options.hour, options.name, phrasing)} ${where} ${status}`);
}

/** When the caller says hello again mid-call. */
export function stillHere(phrasing: Phrasing = FIRST_WORDING): string {
  return phrasing.pick("still-here", [
    withMood("warm", "Still here. What may I do for you?"),
    withMood("warm", "Right here. What can I do for you?"),
    withMood("warm", "I'm with you. What would you like?"),
    withMood("warm", "Still here, and all ears."),
  ]);
}

export function goodbye(phrasing: Phrasing = FIRST_WORDING): string {
  return phrasing.pick("goodbye", [
    withMood("warm", "Very good. Goodbye."),
    withMood("warm", "Goodbye. I'll be here when you need me."),
    withMood("warm", "Until next time. Goodbye."),
    withMood("warm", "Very good. Take care."),
  ]);
}

export function routeFailed(phrasing: Phrasing = FIRST_WORDING): string {
  return phrasing.pick("route-failed", [
    withMood("sorry", "I'm afraid I couldn't reach your Mac's task list. Please try again in a moment."),
    withMood("sorry", "I'm afraid that didn't get through to your Mac. Would you say it once more?"),
  ]);
}

export const STILL_HERE = stillHere();
export const GOODBYE = goodbye();
export const ROUTE_FAILED = routeFailed();

export const NOT_LINKED = withMood(
  "sorry",
  "I'm afraid this number isn't linked to Spectr yet. In the Spectr app, open Setup, add this number, then call again. Goodbye.",
);

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
