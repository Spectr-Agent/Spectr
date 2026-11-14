// Claude API adapter. Returns the model's proposed action as `unknown`; plan.ts
// validates it with Zod and runs it through the rule gate. Never trust it here.

import Anthropic from "@anthropic-ai/sdk";
import type { AgentState, Settings } from "./actions.js";
import { buildSystemPrompt } from "./systemPrompt.js";

export interface Screenshot {
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  /** Base64 without a data: prefix. Sent to the API only; never logged or stored. */
  base64: string;
}

export interface ModelRequest {
  utterance: string;
  state: AgentState;
  settings: Settings;
  screenshot?: Screenshot | null;
}

/** Anything that can propose one action. Tests pass a fake. */
export interface ModelClient {
  /** Resolves to the raw proposed action, or null on timeout, error or no tool call. */
  nextAction(request: ModelRequest): Promise<unknown | null>;
}

export const DEFAULT_MODEL = "claude-haiku-5-5";
export const MODEL_TIMEOUT_MS = 8_000;

type ToolInputSchema = Anthropic.Messages.Tool.InputSchema;
const noInput: ToolInputSchema = { type: "object", properties: {}, additionalProperties: false };
const text = (max: number) => ({ type: "string", minLength: 1, maxLength: max });

/**
 * Tools the model may call: the contract's Mac actions, lookAtScreen and the
 * user messages. Proposed actions (openApp, click, typeText, pressKey, scroll)
 * are added here once they are in contracts/. Written by hand because Zod 3
 * has no JSON Schema export; plan.ts still validates every call with Zod.
 */
export const TOOL_SPECS: ReadonlyArray<{ name: string; description: string; input_schema: ToolInputSchema }> = [
  { name: "openDemoDeck", description: "Open the practice Keynote deck.", input_schema: noInput },
  {
    name: "goToSlide",
    description: "Go to an absolute slide number in the open deck.",
    input_schema: {
      type: "object",
      properties: { number: { type: "integer" }, risk: { type: "string", enum: ["low", "high"] } },
      required: ["number"],
      additionalProperties: false,
    },
  },
  { name: "stop", description: "Stop everything immediately.", input_schema: noInput },
  { name: "lookAtScreen", description: "Ask for fresh Mac state before deciding.", input_schema: noInput },
  {
    name: "askQuestion",
    description: "Ask the owner one short question when the request is unclear.",
    input_schema: { type: "object", properties: { text: text(300) }, required: ["text"], additionalProperties: false },
  },
  {
    name: "refuse",
    description: "Decline the request with a short reason.",
    input_schema: { type: "object", properties: { reason: text(300) }, required: ["reason"], additionalProperties: false },
  },
  {
    name: "finish",
    description: "Report that the goal is done, describing what the Mac shows.",
    input_schema: { type: "object", properties: { summary: text(300) }, required: ["summary"], additionalProperties: false },
  },
];

export function buildTools(): Anthropic.Messages.Tool[] {
  return TOOL_SPECS.map((t) => ({ ...t }));
}

function oneLine(s: string, max: number): string {
  return s.replace(/\s+/g, " ").slice(0, max);
}

/** Compact state block. Screen text is fenced and labeled untrusted. */
export function buildStateBlock(state: AgentState): string {
  const history = state.history
    .slice(-6)
    .map((h) => {
      const r = h.result;
      const result = r ? `outcome=${r.outcome} slide=${r.observedSlide ?? "?"}` : "no result yet";
      return `- ${JSON.stringify(h.command.action)} -> ${result}`;
    })
    .join("\n");
  const screen = state.screenText ? oneLine(state.screenText, 2000).replace(/<\/?screen_text>/gi, "") : "";
  return [
    `frontApp: ${state.frontApp ?? "unknown"}`,
    `observedSlide: ${state.observedSlide ?? "unknown"}`,
    `deckLength: ${state.deckLength}`,
    `focusedFieldIsSecure: ${state.focusedFieldIsSecure ?? false}`,
    `stepsUsed: ${state.stepsUsed}`,
    `history:\n${history || "- none"}`,
    `<screen_text>${screen || "none"}</screen_text>`,
  ].join("\n");
}

export interface ClaudeModelClientOptions {
  /** Defaults to process.env.SPECTR_MODEL, then DEFAULT_MODEL. */
  model?: string;
  timeoutMs?: number;
  /** Injected for tests. Defaults to a client that reads ANTHROPIC_API_KEY. */
  client?: Pick<Anthropic, "messages">;
}

export function createClaudeModelClient(options: ClaudeModelClientOptions = {}): ModelClient {
  const timeoutMs = options.timeoutMs ?? MODEL_TIMEOUT_MS;
  const client =
    options.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: timeoutMs, maxRetries: 0 });
  const model = options.model ?? process.env.SPECTR_MODEL ?? DEFAULT_MODEL;
  const tools = buildTools();

  return {
    async nextAction({ utterance, state, settings, screenshot }) {
      const content: Anthropic.Messages.ContentBlockParam[] = [];
      if (screenshot) {
        content.push({ type: "image", source: { type: "base64", media_type: screenshot.mediaType, data: screenshot.base64 } });
      }
      content.push({
        type: "text",
        text: `Current state:\n${buildStateBlock(state)}\n\nOwner's message:\n${oneLine(utterance, 1000)}`,
      });

      try {
        const response = await client.messages.create(
          {
            model,
            max_tokens: 2048,
            system: buildSystemPrompt({ deckLength: state.deckLength, settings }),
            tools,
            // Forced tool choice ("any") is rejected by newer models, so use auto
            // with parallel calls off and treat a reply with no tool call as a failure.
            tool_choice: { type: "auto", disable_parallel_tool_use: true },
            output_config: { effort: "low" },
            messages: [{ role: "user", content }],
          },
          { timeout: timeoutMs, maxRetries: 0, signal: AbortSignal.timeout(timeoutMs) },
        );
        if (response.stop_reason === "refusal") return null;
        const toolUses = response.content.filter((b) => b.type === "tool_use");
        if (toolUses.length !== 1) return null;
        const call = toolUses[0]!;
        const input = typeof call.input === "object" && call.input !== null ? call.input : {};
        return { ...input, type: call.name };
      } catch (err) {
        // Log only the error class. Never the key, the prompt or the screenshot.
        console.warn(JSON.stringify({ event: "agent.model_error", taskId: state.taskId, error: (err as Error)?.name ?? "Error" }));
        return null;
      }
    },
  };
}
