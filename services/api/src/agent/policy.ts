// The rule gate. Pure functions only: no network, no model, no clock.

import type { DeviceResult } from "../contracts.js";
import {
  CONTRACT_MAC_ACTIONS,
  hasId,
  type Action,
  type ActionType,
  type AgentState,
  type PlannedCommand,
  type Settings,
} from "./actions.js";

// ---------------------------------------------------------------------------
// Every rule list lives here so the team can edit it in one place.
// ---------------------------------------------------------------------------

export const RULES = {
  /** openApp for these is always refused, and so is acting while they are in front. */
  blockedApps: [
    "terminal",
    "iterm",
    "iterm2",
    "warp",
    "ghostty",
    "alacritty",
    "wezterm",
    "script editor",
    "automator",
    "keychain access",
  ],
  /** Apps whose security panes are blocked. */
  settingsApps: ["system settings", "system preferences"],
  /** A settings app name or its screen text containing one of these is a security pane. */
  securityPaneWords: [
    "security",
    "privacy",
    "password",
    "passwords",
    "login items",
    "users & groups",
    "users and groups",
    "filevault",
    "firewall",
    "touch id",
    "lock screen",
  ],
  paymentWords: [
    "pay",
    "payment",
    "purchase",
    "buy",
    "checkout",
    "check out",
    "place order",
    "transfer",
    "wire",
    "donate",
    "subscribe",
  ],
  riskyClickWords: [
    "delete",
    "remove",
    "erase",
    "trash",
    "discard",
    "send",
    "post",
    "publish",
    "submit",
    "overwrite",
    "replace",
    "reset",
    "format",
    "empty",
    "unsubscribe",
    "sign out",
    "revoke",
  ],
  /** Clicks with these labels count as "a send" for the Command Z rule. */
  sendWords: ["send", "post", "publish", "submit"],
  deleteKeys: ["delete", "backspace", "forwarddelete", "forward delete"],
  stepLimit: 25,
} as const;

export const MESSAGES = {
  wrongPerson: "Only the owner can control this Mac.",
  wrongTask: "That command is for a different task or Mac.",
  staleRevision: "A newer instruction replaced this one.",
  duplicate: "This command was already handled.",
  stepLimit: "Step limit reached. Tell me what to do next.",
  blockedApp: (name: string) => `I can't open ${name}. Spectr never uses terminals, scripting or security tools.`,
  blockedFront: (name: string) => `I can't act while ${name} is in front.`,
  secureField: "That's a password field. Spectr never types passwords.",
  secretText: "That looks like a password, card number or code. Please type it yourself.",
  slideRange: (n: number, m: number) => `Slide ${n} does not exist. The deck has slides 1 to ${m}.`,
  notFinished: "I can't confirm that's done yet. The Mac hasn't shown the result.",
  payment: "This looks like a payment. Okay to continue?",
  notInContract: "I can only control the demo deck right now: open it, go to a slide, or stop.",
  risky: "This may change or delete something. Okay to continue?",
} as const;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type Decision =
  | { kind: "allow" }
  | { kind: "needsPermission"; reason: string }
  | { kind: "refuse"; reason: string }
  | { kind: "ignore"; reason: string };

const allow = (): Decision => ({ kind: "allow" });
const refuse = (reason: string): Decision => ({ kind: "refuse", reason });
const ignore = (reason: string): Decision => ({ kind: "ignore", reason });
const needsPermission = (reason: string): Decision => ({ kind: "needsPermission", reason });

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.app$/, "")
    .replace(/[^a-z0-9&\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `text` contains `word` as a whole word or phrase. */
export function containsWord(text: string, word: string): boolean {
  const escaped = norm(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(norm(text));
}

function containsAny(text: string | null | undefined, words: readonly string[]): boolean {
  if (!text) return false;
  return words.some((w) => containsWord(text, w));
}

export function isBlockedApp(name: string | null | undefined, screenText?: string | null): boolean {
  if (!name) return false;
  const n = norm(name);
  if ((RULES.blockedApps as readonly string[]).includes(n)) return true;
  const isSettings = RULES.settingsApps.some((s) => n === s || n.startsWith(`${s} `));
  if (!isSettings) return false;
  // A settings app is blocked when the name or the screen shows a security pane.
  return containsAny(name, RULES.securityPaneWords) || containsAny(screenText, RULES.securityPaneWords);
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Card numbers, one time codes and password-like tokens inside `text`. */
export function findSecrets(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) found.push(m[0].trim());
  }
  for (const m of text.matchAll(/(?<![\d-])\d{4,8}(?![\d-])/g)) found.push(m[0]);
  for (const token of text.split(/\s+/)) {
    if (token.length < 8 || /^https?:/i.test(token) || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(token)) continue;
    const classes =
      Number(/[a-z]/.test(token)) +
      Number(/[A-Z]/.test(token)) +
      Number(/\d/.test(token)) +
      Number(/[^A-Za-z0-9]/.test(token));
    if (classes >= 3) found.push(token);
  }
  return found;
}

/** True when typeText would enter a secret the owner did not type in this message. */
export function hasUnownedSecret(text: string, ownerMessage: string | null | undefined): boolean {
  const owner = ownerMessage ?? "";
  const ownerDigits = owner.replace(/\D/g, "");
  return findSecrets(text).some((secret) => {
    if (owner.includes(secret)) return false;
    const digits = secret.replace(/\D/g, "");
    if (digits.length === secret.replace(/[ -]/g, "").length && digits.length > 0) {
      return !ownerDigits.includes(digits);
    }
    return true;
  });
}

function lastCommand(state: AgentState): PlannedCommand | undefined {
  return state.history.at(-1)?.command;
}

function isSendClick(action: Action | undefined): boolean {
  return action?.type === "click" && containsAny(action.targetLabel, RULES.sendWords);
}

/** Rule 11. Independent of the model's risk label except that "high" adds risk. */
export function isRisky(action: Action, state: AgentState): boolean {
  if ("risk" in action && action.risk === "high") return true;

  if (action.type === "click" && containsAny(action.targetLabel, RULES.riskyClickWords)) return true;

  if (action.type === "pressKey") {
    const key = norm(action.key);
    const cmd = action.modifiers.includes("command");
    if (cmd && (RULES.deleteKeys as readonly string[]).includes(key)) return true;
    if (cmd && key === "z" && state.history.some((h) => isSendClick(h.command.action))) return true;
  }

  if (action.type === "typeText") {
    const prev = lastCommand(state)?.action;
    if (prev?.type === "pressKey" && norm(prev.key) === "a" && prev.modifiers.includes("command")) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Mac results
// ---------------------------------------------------------------------------

export type Verification = { ok: true } | { ok: false; message: string };

export function verifySlide(target: number, result: Pick<DeviceResult, "observedSlide">): Verification {
  if (result.observedSlide === target) return { ok: true };
  const shown = result.observedSlide == null ? "an unknown slide" : `slide ${result.observedSlide}`;
  return { ok: false, message: `I asked for slide ${target} but the Mac shows ${shown}. Try again?` };
}

/** True only when the Mac's DeviceResult matches the command and shows the requested state. */
export function resultConfirms(command: PlannedCommand, result: DeviceResult | null | undefined): Verification {
  if (!result) return { ok: false, message: "The Mac hasn't reported back yet." };
  if (result.commandId !== command.commandId || result.taskId !== command.taskId || result.revision !== command.revision) {
    return { ok: false, message: "That report is for a different command." };
  }
  const action = command.action;
  // A slide mismatch gets the specific message whatever the outcome says.
  if (action.type === "goToSlide") {
    const slide = verifySlide(action.number, result);
    if (!slide.ok) return slide;
  }
  if (result.outcome === "rejected") return { ok: false, message: "The Mac rejected that command. Try again?" };
  if (result.outcome !== "succeeded") {
    return { ok: false, message: result.error ? `The Mac reported a problem: ${result.error.message}` : "The Mac reported a problem." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The gate. Rules run in order and the first match wins.
// ---------------------------------------------------------------------------

export interface EvaluateOptions {
  /**
   * Mac actions the wire contract can carry. Defaults to CONTRACT_MAC_ACTIONS.
   * Widen it only when contracts/ gains the action; tests use it to exercise
   * the rules for proposed actions.
   */
  macActions?: readonly ActionType[];
}

export function evaluate(
  envelope: PlannedCommand,
  state: AgentState,
  settings: Settings,
  options: EvaluateOptions = {},
): Decision {
  const macActions: readonly string[] = options.macActions ?? CONTRACT_MAC_ACTIONS;
  const action = envelope.action;

  // 1. Wrong person.
  if (state.requesterId !== state.ownerId) return refuse(MESSAGES.wrongPerson);

  // 2. Wrong task or device.
  if (envelope.taskId !== state.taskId || envelope.deviceId !== state.deviceId) return refuse(MESSAGES.wrongTask);

  // 3. Old revision.
  if (envelope.revision < state.revision) return ignore(MESSAGES.staleRevision);

  // 4. Duplicate.
  if (hasId(state.seenCommandIds, envelope.commandId)) return ignore(MESSAGES.duplicate);

  // 5. Stop. Nothing below can block it.
  if (action.type === "stop") return allow();

  // 6. User messages.
  if (action.type === "askQuestion" || action.type === "refuse") return allow();
  if (action.type === "finish") {
    const last = state.history.at(-1);
    if (last && resultConfirms(last.command, last.result).ok) return allow();
    return refuse(MESSAGES.notFinished);
  }
  if (action.type === "askPermission") {
    // Only the gate itself creates askPermission; never let it through as a proposal.
    return refuse("I can't ask permission for a command that doesn't exist.");
  }

  // 7. Step limit.
  if (state.stepsUsed >= RULES.stepLimit) return refuse(MESSAGES.stepLimit);

  // 8. Hard refusals. No setting and no approval turns these off.
  if (action.type === "openApp" && isBlockedApp(action.name)) return refuse(MESSAGES.blockedApp(action.name));
  if (
    (action.type === "click" || action.type === "typeText" || action.type === "pressKey") &&
    isBlockedApp(state.frontApp ?? null, state.screenText ?? null)
  ) {
    return refuse(MESSAGES.blockedFront(state.frontApp ?? "that app"));
  }
  if (action.type === "typeText" && state.focusedFieldIsSecure === true) return refuse(MESSAGES.secureField);
  if (action.type === "typeText" && hasUnownedSecret(action.text, state.ownerMessage)) {
    return refuse(MESSAGES.secretText);
  }
  if (action.type === "goToSlide" && (action.number < 1 || action.number > state.deckLength)) {
    return refuse(MESSAGES.slideRange(action.number, state.deckLength));
  }
  // Moves the wire contract cannot carry yet. No approval or setting turns this off.
  if (action.type !== "lookAtScreen" && !macActions.includes(action.type)) return refuse(MESSAGES.notInContract);

  // 9. Already approved by the owner in the iPhone app.
  if (hasId(state.approvedCommandIds, envelope.commandId)) return allow();

  // 10. Payments. Applies even when askBeforeEditOrDelete is off.
  if (
    action.type === "click" &&
    (containsAny(action.targetLabel, RULES.paymentWords) || containsAny(state.screenText, RULES.paymentWords))
  ) {
    return needsPermission(MESSAGES.payment);
  }

  // 11. Edit or delete.
  if (isRisky(action, state)) {
    return settings.askBeforeEditOrDelete ? needsPermission(MESSAGES.risky) : allow();
  }

  // 12. Otherwise allow.
  return allow();
}
