import { InboundMessageSchema, type Command } from "./contracts.js";
import {
  handleOnboardingReply,
  startOnboarding,
  type OnboardingStore,
  type OnboardingTurnLog,
} from "./agent/onboarding/index.js";
import type {
  AgentTaskRecord,
  InboundKind,
  PendingInboundMessage,
  PersistAgentStepInput,
  SessionTurn,
} from "./agent/types.js";

export interface TaskStore {
  routeInbound(input: {
    providerMessageId: string;
    ownerId: string;
    deviceId: string;
    text: string;
    replyProvider: "sendblue" | "chert" | "call" | "app";
    replyHandle: string;
    now: Date;
    /** Continue this chat when the message starts a new task. */
    sessionId?: string;
  }): Promise<{ taskId: string; kind: InboundKind; created: boolean }>;
  isInboundReplySent(providerMessageId: string): Promise<boolean>;
  markInboundReplySent(providerMessageId: string): Promise<void>;
  // Insert-or-return-existing keyed on commandId.
  insertCommand(command: Command): Promise<{ command: Command; created: boolean }>;
  authenticateDevice(tokenHash: string): Promise<string | null>;
  getActiveTaskForDevice(
    deviceId: string,
    now: Date,
  ): Promise<AgentTaskRecord | null>;
  getTaskForDevice(
    taskId: string,
    deviceId: string,
  ): Promise<AgentTaskRecord | null>;
  getTask(taskId: string): Promise<AgentTaskRecord | null>;
  getUnconsumedInboundMessages(
    taskId: string,
  ): Promise<PendingInboundMessage[]>;
  /** Earlier tasks in the same chat, oldest first. Optional so simple stores can skip it. */
  getEarlierSessionTurns?(task: AgentTaskRecord): Promise<SessionTurn[]>;
  persistAgentStep(input: PersistAgentStepInput): Promise<boolean>;
  claimResultNotification(taskId: string, now: Date): Promise<AgentTaskRecord | null>;
}

/** Optional: when set, texts can be answers to onboarding questions or onboarding commands. */
export interface InboundOnboarding {
  store: OnboardingStore;
  turns: OnboardingTurnLog;
}

export interface InboundDeps {
  store: TaskStore;
  onboarding?: InboundOnboarding;
  provider: "sendblue" | "chert";
  resolveSender(
    fromNumber: string,
  ): Promise<{ ownerId: string; deviceId: string } | null>;
  sendReply(
    toNumber: string,
    text: string,
    idempotencyKey: string,
    mediaUrl?: string,
  ): Promise<void>;
  /** Tells the Mac to check for work now rather than at its next poll. Never throws. */
  wakeMac?(deviceId: string): Promise<void>;
}

export type InboundOutcome =
  | {
      status: "created" | "duplicate";
      taskId: string;
      kind: InboundKind;
    }
  | { status: "onboarding" }
  | { status: "ignored"; reason: "unknownSender" };

export function isStop(text: string): boolean {
  return [
    "stop",
    "cancel",
    "abort",
    "stop it",
    "nevermind",
    "never mind",
  ].includes(text.trim().toLowerCase().replace(/[.!]+$/u, ""));
}

function replyForInbound(kind: InboundKind): string {
  switch (kind) {
    case "task":
      return "Right away.";
    case "correction":
      return "Understood. Changing course.";
    case "answer":
      return "Thank you. Continuing.";
    case "stop":
      return "Stopped.";
  }
}

function onboardingCommand(text: string): "change" | "forget" | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/u, "");
  if (t === "change my preferences") return "change";
  if (t === "forget that") return "forget";
  return null;
}

/**
 * Handles a text that belongs to onboarding: the person is partway through the
 * questions, or sent "change my preferences" / "forget that". Returns null for
 * an ordinary message, which then runs as a task.
 */
async function handleOnboardingMessage(
  message: { providerMessageId: string; fromNumber: string; text: string },
  ownerId: string,
  onboarding: InboundOnboarding,
  deps: InboundDeps,
): Promise<InboundOutcome | null> {
  const command = onboardingCommand(message.text);
  if (!command && !(await onboarding.store.getState(ownerId))) return null;

  // A repeat delivery of the same text must not move the questions on again.
  if (!(await onboarding.turns.claim(message.providerMessageId, ownerId))) {
    return { status: "onboarding" };
  }

  let say: string;
  if (command === "forget") {
    await onboarding.store.deleteState(ownerId);
    await onboarding.store.deleteProfile(ownerId);
    say = "Certainly. I've forgotten what I had saved about you.";
  } else if (command === "change") {
    say = (await startOnboarding(ownerId, onboarding, await onboarding.store.getProfile(ownerId))).say;
  } else {
    const turn = await handleOnboardingReply(ownerId, message.text, onboarding);
    if (!turn) return null;
    say = turn.say;
  }

  await deps.sendReply(message.fromNumber, say, `onboarding-${message.providerMessageId}`);
  return { status: "onboarding" };
}

export async function handleInboundMessage(
  raw: unknown,
  deps: InboundDeps,
): Promise<InboundOutcome> {
  const message = InboundMessageSchema.parse(raw);
  const sender = await deps.resolveSender(message.fromNumber);

  if (!sender) {
    return { status: "ignored", reason: "unknownSender" };
  }

  if (deps.onboarding) {
    const outcome = await handleOnboardingMessage(message, sender.ownerId, deps.onboarding, deps);
    if (outcome) return outcome;
  }

  const routed = await deps.store.routeInbound({
    providerMessageId: message.providerMessageId,
    ownerId: sender.ownerId,
    deviceId: sender.deviceId,
    text: message.text,
    replyProvider: deps.provider,
    replyHandle: message.fromNumber,
    now: new Date(),
  });
  // Start the wake before replying so the Mac begins while the text goes out.
  const waking = deps.wakeMac?.(sender.deviceId);

  if (!(await deps.store.isInboundReplySent(message.providerMessageId))) {
    await deps.sendReply(
      message.fromNumber,
      replyForInbound(routed.kind),
      `reply-${message.providerMessageId}`,
    );
    await deps.store.markInboundReplySent(message.providerMessageId);
  }
  await waking;

  return {
    status: routed.created ? "created" : "duplicate",
    taskId: routed.taskId,
    kind: routed.kind,
  };
}
