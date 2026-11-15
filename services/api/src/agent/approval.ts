import type { AgentMessage } from "./types.js";

export const RISKY_ACTION_TOOL = "risky_action";

const YES = /^\s*(yes|y|yeah|yep|sure|ok|okay)\b/i;
const REPLY_PREFIX = 'The user replied: "';

export function blockedMessage(action: string): string {
  return `Blocked: "${action}" has no approval. Call ask_user with action set to exactly "${action}" and wait for a yes, then call risky_action again.`;
}

function normalize(action: unknown): string | null {
  return typeof action === "string" && action.trim() ? action.trim().toLowerCase() : null;
}

function blocks(message: AgentMessage): Record<string, unknown>[] {
  return Array.isArray(message.content)
    ? message.content.filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
    : [];
}

function toolUsesNamed(message: AgentMessage, name: string): Array<{ id: unknown; action: string | null }> {
  if (message.role !== "assistant") return [];
  return blocks(message)
    .filter((b) => b.type === "tool_use" && b.name === name && b.toolset_name === undefined)
    .map((b) => ({
      id: b.id,
      action: normalize((b.input as Record<string, unknown> | null)?.action),
    }));
}

/**
 * True only if the latest ask_user for this exact action was answered "yes"
 * and nothing since has revoked it: a correction from the user, or an earlier
 * risky_action that already used it. `history` must not include the turn
 * being checked.
 */
export function hasApproval(history: AgentMessage[], action: string): boolean {
  const wanted = normalize(action);
  if (!wanted) return false;
  let askIndex = -1;
  let askId: unknown;
  for (let i = history.length - 1; i >= 0 && askIndex < 0; i -= 1) {
    const found = toolUsesNamed(history[i]!, "ask_user").find((use) => use.action === wanted);
    if (found) {
      askIndex = i;
      askId = found.id;
    }
  }
  if (askIndex < 0) return false;

  let answered = false;
  for (const message of history.slice(askIndex)) {
    if (toolUsesNamed(message, RISKY_ACTION_TOOL).some((use) => use.action === wanted)) return false;
    if (message.role !== "user") continue;
    for (const block of blocks(message)) {
      if (block.type === "tool_result" && block.tool_use_id === askId && block.is_error !== true) {
        const text = typeof block.content === "string" ? block.content : "";
        answered = text.startsWith(REPLY_PREFIX) && YES.test(text.slice(REPLY_PREFIX.length));
      }
      if (block.type === "text" && typeof block.text === "string" && block.text.startsWith("The user sent a correction")) {
        answered = false;
      }
    }
  }
  return answered;
}
