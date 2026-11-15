// Test helpers for driving the real step loop with a scripted Claude and a
// pretend Mac. The Mac records every action it is told to run. Actions whose
// id starts with "commit" are the ones that can't be undone (send, submit,
// pay); the Mac notes a violation if one runs without a fresh "yes".

import { vi } from "vitest";
import type { AnthropicRequest, AnthropicResponse, CallClaude } from "../../src/agent/anthropic.js";
import { runAgentStep } from "../../src/agent/step.js";
import type { ToolUse } from "../../src/agent/tools.js";
import { MacStepRequestSchema, MacStepResponseSchema, type MacStepRequest, type MacStepResponse } from "../../src/contracts.js";
import { InMemoryTaskStore } from "../../src/memory-store.js";

export const deviceId = "dev_loop_mac";
export const ownerId = "owner_loop";

export function request(taskId: string, overrides: Partial<MacStepRequest> = {}): MacStepRequest {
  return MacStepRequestSchema.parse({
    taskId,
    afterStep: 0,
    screenshot: { mediaType: "image/png", data: "aGVsbG8=", width: 100, height: 100 },
    results: [],
    ...overrides,
  });
}

export const computer = (id: string, name: string, input: unknown = {}): ToolUse => ({ type: "tool_use", id, name, input, toolset_name: "computer" });
export const custom = (id: string, name: string, input: unknown): ToolUse => ({ type: "tool_use", id, name, input });
export const reply = (...content: unknown[]): AnthropicResponse => ({ content, stop_reason: "tool_use" });
export const finish = (success: boolean, summary: string) => reply(custom(`finish-${Math.random()}`, "finish", { success, summary }));
export const ask = (question: string, action?: string) => reply(custom(`ask-${Math.random()}`, "ask_user", action ? { question, action } : { question }));
export const risky = (action: string) => custom(`risky-${Math.random()}`, "risky_action", { action });

/** A fake Claude that plays turns in order and snapshots every request it gets. */
export function scriptedClaude(...turns: AnthropicResponse[]) {
  const sent: AnthropicRequest[] = [];
  const call: CallClaude = vi.fn(async (body: AnthropicRequest) => {
    sent.push(structuredClone(body));
    const next = turns.shift();
    if (!next) throw new Error("Unexpected Claude call");
    return next;
  });
  return { call, sent, remaining: () => turns.length };
}

export type ScriptedClaude = ReturnType<typeof scriptedClaude>;

export async function route(store: InMemoryTaskStore, text: string, providerMessageId = `msg-${Math.random()}`) {
  return store.routeInbound({
    providerMessageId,
    ownerId,
    deviceId,
    text,
    replyProvider: "sendblue",
    replyHandle: "+15555550100",
    now: new Date(),
  });
}

const COMMIT_PREFIX = "commit";
const YES = /^\s*(yes|y|yeah|yep|sure|ok|okay)\b/i;

/** One task run end to end: the owner texts, Claude is scripted, the Mac records what it ran. */
export class Session {
  readonly store = new InMemoryTaskStore();
  taskId = "";
  /** Action ids the Mac ran, in order. */
  readonly executed: string[] = [];
  /** Commit steps that ran without a "yes" given after the latest question. */
  readonly violations: string[] = [];
  last: MacStepResponse | null = null;
  private pending: Array<{ actionId: string }> = [];
  private approved = false;

  constructor(readonly claude: ScriptedClaude) {}

  async start(instruction: string): Promise<MacStepResponse> {
    this.taskId = (await route(this.store, instruction)).taskId;
    return this.advance();
  }

  /** The owner texts something. A "yes" while a question is open counts as an approval. */
  async say(text: string, providerMessageId?: string) {
    const routed = await route(this.store, text, providerMessageId);
    if (this.last?.kind === "waiting" && YES.test(text)) this.approved = true;
    return routed;
  }

  /** Run exactly one step: ask Claude, then let the Mac run whatever it returns. */
  async stepOnce(): Promise<MacStepResponse> {
    const response = MacStepResponseSchema.parse(
      await runAgentStep({
        store: this.store,
        deviceId,
        request: request(this.taskId, {
          afterStep: this.last?.step ?? 0,
          results: this.pending.map((a) => ({ actionId: a.actionId, ok: true })),
        }),
        callClaude: this.claude.call,
      }),
    );
    this.last = response;
    this.pending = [];
    if (response.kind === "waiting") this.approved = false;
    if (response.kind === "actions") {
      for (const { actionId } of response.actions) {
        this.executed.push(actionId);
        this.pending.push({ actionId });
        if (actionId.startsWith(COMMIT_PREFIX)) {
          if (!this.approved) this.violations.push(actionId);
          this.approved = false; // an approval covers one commit
        }
      }
    }
    return response;
  }

  /** Keep stepping until Claude asks something or the task ends. */
  async advance(): Promise<MacStepResponse> {
    for (let i = 0; i < 20; i += 1) {
      const response = await this.stepOnce();
      if (response.kind !== "actions") return response;
    }
    throw new Error("The task never reached a question or an end");
  }
}
