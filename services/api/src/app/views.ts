// What the iPhone app sees of a task, a Mac and the account. Everything here is derived
// from rows the backend already keeps; nothing is invented for display.

import type { MacAction, MacStepResponse } from "../contracts.js";

export type AppTaskState = "accepted" | "running" | "waitingForUser" | "succeeded" | "failed" | "cancelled";

export interface AppTaskView {
  taskId: string;
  /** The chat this task belongs to. A task that starts a chat is its own session. */
  sessionId: string;
  deviceId: string;
  state: AppTaskState;
  revision: number;
  instruction: string;
  /** Set while Spectr waits for an answer or an approval. */
  question: string | null;
  /** True when the question is a yes/no approval (send, post, buy, submit, delete). */
  needsApproval: boolean;
  /** The final verified result, or why it stopped. */
  summary: string | null;
  /** A short description of what the Mac is doing right now. */
  activity: string | null;
  stepCount: number;
  /** Where the task came from: "app", "call", "sendblue" or "chert". */
  source: string | null;
  createdAt: string;
  updatedAt: string;
  /** A signed link to the final screenshot, when there is one. */
  screenshotUrl: string | null;
}

export interface AppMacView {
  deviceId: string;
  name: string;
  /** online: checked in within the last minute. */
  status: "online" | "offline";
  /** True when the Mac is streaming its screen, false when not, null when unknown. */
  sharing: boolean | null;
  lastSeenAt: string | null;
}

export interface TaskRow {
  id: string;
  device_id: string;
  state: AppTaskState;
  revision: number;
  instruction: string;
  question: string | null;
  summary: string | null;
  step_count: number;
  last_step_response: unknown;
  reply_provider: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  has_screenshot: boolean;
  session_id?: string | null;
}

export interface InboundRow {
  task_id: string;
  kind: "task" | "correction" | "answer" | "stop";
  text: string;
  created_at: Date | string;
}

/** One bubble in a chat: something the user said, or Spectr's question or result. */
export interface AppChatMessage {
  id: string;
  taskId: string;
  role: "user" | "spectr";
  text: string;
  at: string;
  /** For Spectr's messages: the task state the message reports. */
  state: AppTaskState | null;
  screenshotUrl: string | null;
}

export const ONLINE_WINDOW_MS = 60_000;

const iso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString();

const APPROVAL = /\b(send|post|publish|buy|purchase|pay|order|submit|delete|remove|confirm|approve|go ahead|okay to|ok to|should i)\b/iu;

/** A question that can be answered with Yes or No. */
export function isApprovalQuestion(question: string | null): boolean {
  if (!question) return false;
  const trimmed = question.trim();
  return trimmed.endsWith("?") && APPROVAL.test(trimmed);
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "a website";
  }
}

function clip(text: string, max = 40): string {
  const single = text.replace(/\s+/gu, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

/** Describes one action in plain words. Never repeats typed text from a secure field. */
export function describeAction(action: MacAction): string | null {
  switch (action.type) {
    case "openApp":
      return `Opening ${action.name}`;
    case "openUrl":
      return `Opening ${host(action.url)}`;
    case "type":
      return `Typing “${clip(action.text)}”`;
    case "key":
      return action.keys.toLowerCase() === "return" || action.keys.toLowerCase() === "enter"
        ? "Pressing Return"
        : `Pressing ${action.keys}`;
    case "click":
      return action.clicks === 2 ? "Double-clicking" : action.button === "right" ? "Right-clicking" : "Clicking";
    case "drag":
      return "Dragging";
    case "scroll":
      return `Scrolling ${action.direction}`;
    case "wait":
      return "Waiting for the screen";
    case "mouseMove":
    case "screenshot":
      return null;
  }
}

function parseStep(value: unknown): MacStepResponse | null {
  if (value == null) return null;
  try {
    return (typeof value === "string" ? JSON.parse(value) : value) as MacStepResponse;
  } catch {
    return null;
  }
}

/** The most meaningful action of the step the Mac is working on. */
export function activityFor(row: Pick<TaskRow, "state" | "last_step_response" | "step_count">): string | null {
  if (row.state === "accepted") return "Starting";
  if (row.state !== "running") return null;
  const step = parseStep(row.last_step_response);
  if (step?.kind === "actions") {
    const described = step.actions.map((item) => describeAction(item.action)).filter((text) => text !== null);
    // Prefer opening or typing over the clicks around them.
    return described.find((text) => /^(Opening|Typing)/u.test(text)) ?? described[0] ?? "Looking at the screen";
  }
  return row.step_count === 0 ? "Looking at the screen" : "Thinking";
}

export function taskView(row: TaskRow, screenshotUrl: (taskId: string) => string | null): AppTaskView {
  return {
    taskId: row.id,
    sessionId: row.session_id ?? row.id,
    deviceId: row.device_id,
    state: row.state,
    revision: row.revision,
    instruction: row.instruction,
    question: row.state === "waitingForUser" ? row.question : null,
    needsApproval: row.state === "waitingForUser" && isApprovalQuestion(row.question),
    summary: row.summary,
    activity: activityFor(row),
    stepCount: row.step_count,
    source: row.reply_provider,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    screenshotUrl: row.has_screenshot ? screenshotUrl(row.id) : null,
  };
}

export function macView(
  row: { id: string; name: string; last_seen_at: Date | string | null },
  sharing: boolean | null,
  now: Date,
): AppMacView {
  const lastSeen = row.last_seen_at == null ? null : new Date(row.last_seen_at);
  const online = lastSeen != null && now.getTime() - lastSeen.getTime() < ONLINE_WINDOW_MS;
  return {
    deviceId: row.id,
    name: row.name,
    status: online ? "online" : "offline",
    sharing: online ? sharing : false,
    lastSeenAt: lastSeen?.toISOString() ?? null,
  };
}

/** The conversation of a chat, oldest first, built from its tasks and the messages routed to them. */
export function chatMessages(
  tasks: TaskRow[],
  inbound: InboundRow[],
  screenshotUrl: (taskId: string) => string | null,
): AppChatMessage[] {
  const messages: AppChatMessage[] = [];
  for (const task of tasks) {
    const said = inbound.filter((message) => message.task_id === task.id);
    if (!said.some((message) => message.kind === "task")) {
      said.unshift({ task_id: task.id, kind: "task", text: task.instruction, created_at: task.created_at });
    }
    said.forEach((message, index) => {
      messages.push({
        id: `${task.id}:u${index}`,
        taskId: task.id,
        role: "user",
        text: message.text,
        at: iso(message.created_at),
        state: null,
        screenshotUrl: null,
      });
    });
    const reply = task.state === "waitingForUser" ? task.question : TERMINAL.has(task.state) ? task.summary : null;
    if (reply) {
      messages.push({
        id: `${task.id}:s`,
        taskId: task.id,
        role: "spectr",
        text: reply,
        at: iso(task.updated_at),
        state: task.state,
        screenshotUrl: TERMINAL.has(task.state) && task.has_screenshot ? screenshotUrl(task.id) : null,
      });
    }
  }
  return messages;
}

const TERMINAL = new Set<AppTaskState>(["succeeded", "failed", "cancelled"]);
