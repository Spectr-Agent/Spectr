// Short status lines for the iPhone app and the Spectr voice, for any task.
// fixtures/status-strings.json and fixtures/guardrail-cases.json are generated
// from this file (see test/agent.status.test.ts), so Jared's app and Colby's
// voice read the same text the backend uses.

import type { MacAction, MacStepResponse } from "../contracts.js";

export type StatusKind = "working" | "waiting" | "done" | "failed" | "stopped" | "device";

/** Mascot images in assets/mascot/{must_have,nice_to_have}/ (use @2x/@3x as needed). */
export type Mascot =
  | "spectr_welcome"
  | "spectr_working"
  | "spectr_success"
  | "spectr_error"
  | "spectr_listening"
  | "spectr_stopped"
  | "spectr_waiting_for_answer"
  | "spectr_link_expired"
  | "spectr_unpaired_phone"
  | "spectr_mic_denied"
  | "spectr_screen_capture_denied"
  | "spectr_permission_automation";

interface Entry {
  kind: StatusKind;
  mascot: Mascot;
  /** Text with {placeholders}. */
  template: string;
}

export const STATUS = {
  // working: shown while the Mac runs a batch
  listening: { kind: "working", mascot: "spectr_listening", template: "Listening." },
  thinking: { kind: "working", mascot: "spectr_working", template: "Right away." },
  checkingScreen: { kind: "working", mascot: "spectr_working", template: "Checking the screen." },
  openingApp: { kind: "working", mascot: "spectr_working", template: "Opening {app}." },
  openingSite: { kind: "working", mascot: "spectr_working", template: "Opening {site}." },
  clicking: { kind: "working", mascot: "spectr_working", template: "Clicking." },
  typing: { kind: "working", mascot: "spectr_working", template: "Typing." },
  pressingKeys: { kind: "working", mascot: "spectr_working", template: "Pressing {keys}." },
  scrolling: { kind: "working", mascot: "spectr_working", template: "Scrolling {direction}." },
  dragging: { kind: "working", mascot: "spectr_working", template: "Dragging." },
  waitingForPage: { kind: "working", mascot: "spectr_working", template: "Waiting for the page to load." },

  // waiting: Spectr needs the owner
  question: { kind: "waiting", mascot: "spectr_waiting_for_answer", template: "{question}" },
  confirm: { kind: "waiting", mascot: "spectr_waiting_for_answer", template: "{action} Reply yes to proceed." },
  login: { kind: "waiting", mascot: "spectr_waiting_for_answer", template: "I'll wait while you sign in on the Mac. Reply done when you're in." },

  // finished
  done: { kind: "done", mascot: "spectr_success", template: "{summary}" },
  failed: { kind: "failed", mascot: "spectr_error", template: "I'm afraid I couldn't finish. {summary}" },
  stopped: { kind: "stopped", mascot: "spectr_stopped", template: "Stopped." },
  slideMismatch: { kind: "failed", mascot: "spectr_error", template: "I asked for slide {target}, but slide {observed} is showing. Shall I try again?" },
  declined: { kind: "failed", mascot: "spectr_error", template: "I'm afraid I can't help with that one, so I've stopped." },
  stepLimit: { kind: "failed", mascot: "spectr_error", template: "I've stopped after 40 steps without finishing." },

  // device and connection states (AGENTS.md: keep lock, sleep, disconnect and denied permission distinct)
  macOffline: { kind: "device", mascot: "spectr_error", template: "Your Mac appears to be offline. Last seen {lastSeen}." },
  macLocked: { kind: "device", mascot: "spectr_error", template: "Your Mac is locked. Unlock it to continue." },
  macAsleep: { kind: "device", mascot: "spectr_error", template: "Your Mac is asleep. Wake it to continue." },
  liveViewStale: { kind: "device", mascot: "spectr_screen_capture_denied", template: "The live view stopped updating. Reconnecting." },
  screenRecordingDenied: {
    kind: "device",
    mascot: "spectr_screen_capture_denied",
    template: "Spectr can't see the screen. Allow Screen Recording for Spectr in System Settings.",
  },
  accessibilityDenied: {
    kind: "device",
    mascot: "spectr_permission_automation",
    template: "Spectr can't click or type. Allow Accessibility for Spectr in System Settings.",
  },
  micDenied: { kind: "device", mascot: "spectr_mic_denied", template: "Spectr can't hear you. Allow the microphone, or type instead." },
  linkExpired: { kind: "device", mascot: "spectr_link_expired", template: "This link expired. Text Spectr again for a new one." },
  phoneNotPaired: { kind: "device", mascot: "spectr_unpaired_phone", template: "This phone isn't paired with a Mac yet." },
} as const satisfies Record<string, Entry>;

export type StatusKey = keyof typeof STATUS;

/** Longest a rendered line should be, so it can be spoken and fit on a phone. */
export const MAX_STATUS_LENGTH = 120;

/** Fill a template's {placeholders}. Missing values are left as-is. */
export function status(key: StatusKey, values: Record<string, string | number> = {}): string {
  return STATUS[key].template.replace(/\{(\w+)\}/g, (m, name: string) => (name in values ? String(values[name]) : m));
}

export function placeholders(key: StatusKey): string[] {
  return [...STATUS[key].template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
}

function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the site";
  }
}

function keysName(keys: string): string {
  const names: Record<string, string> = { cmd: "Command", command: "Command", ctrl: "Control", alt: "Option", option: "Option", shift: "Shift", super: "Command" };
  return keys
    .split("+")
    .map((k) => names[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k[0]!.toUpperCase() + k.slice(1)))
    .join("-");
}

/** The line to show while the Mac runs one action. Never repeats typed text. */
export function statusForAction(action: MacAction): string {
  switch (action.type) {
    case "screenshot":
      return status("checkingScreen");
    case "click":
      return status("clicking");
    case "mouseMove":
      return status("thinking");
    case "drag":
      return status("dragging");
    case "scroll":
      return status("scrolling", { direction: action.direction });
    case "type":
      return status("typing");
    case "key":
      return status("pressingKeys", { keys: keysName(action.keys) });
    case "wait":
      return status("waitingForPage");
    case "openApp":
      return status("openingApp", { app: action.name });
    case "openUrl":
      return status("openingSite", { site: siteName(action.url) });
  }
}

/** The line to show for a step response from the agent. */
export function statusForResponse(response: MacStepResponse): string {
  switch (response.kind) {
    case "actions": {
      const main = response.actions.find((a) => a.action.type !== "screenshot" && a.action.type !== "wait") ?? response.actions[0]!;
      return statusForAction(main.action);
    }
    case "waiting":
      return status("question", { question: response.question });
    case "finished":
      if (response.state === "cancelled") return status("stopped");
      return status(response.state === "succeeded" ? "done" : "failed", { summary: response.summary });
  }
}

export interface StatusExport {
  key: StatusKey;
  kind: StatusKind;
  mascot: Mascot;
  template: string;
  params: string[];
}

export function exportStatusStrings(): StatusExport[] {
  return (Object.keys(STATUS) as StatusKey[]).map((key) => ({
    key,
    kind: STATUS[key].kind,
    mascot: STATUS[key].mascot,
    template: STATUS[key].template,
    params: placeholders(key),
  }));
}
