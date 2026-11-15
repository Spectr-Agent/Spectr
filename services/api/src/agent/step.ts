import { createHmac } from "node:crypto";
import {
  MacStepResponseSchema,
  type MacAction,
  type MacStepRequest,
  type MacStepResponse,
} from "../contracts.js";
import type { TaskStore } from "../inbound.js";
import type {
  AgentMessage,
  AgentTaskRecord,
  PendingInboundMessage,
  SessionTurn,
} from "./types.js";
import { profileContext } from "./onboarding/context.js";
import { shouldSendProgress } from "./onboarding/updates.js";
import type { OnboardingStore } from "./onboarding/store.js";
import { slideMismatchSummary, targetSlide } from "./slides.js";
import { status, statusForResponse } from "./status.js";
import {
  anthropicRequest,
  AnthropicHttpError,
  type AnthropicRequest,
  type AnthropicResponse,
  type CallClaude,
} from "./anthropic.js";
import { blockedMessage, hasApproval } from "./approval.js";
import { apiError, ApiErrorException } from "./errors.js";
import {
  mapToolUse,
  MAX_SUMMARY_CHARS,
  type ToolUse,
} from "./tools.js";

export const MAX_AGENT_STEPS = 60;
const MAX_CLAUDE_CALLS_PER_STEP = 3;
const REQUEST_DEADLINE_MS = 280_000;
const CLAUDE_TIMEOUT_MS = 90_000;
const CLAUDE_TIMEOUT_BUFFER_MS = 5_000;
const MINIMUM_CALL_WINDOW_MS = 15_000;
export const REFUSAL_SUMMARY = "I'm afraid I can't help with that one, so I've stopped.";
export const CUT_OFF_SUMMARY = "My reply was cut short, so I've stopped. Please try again.";

function hasToolUse(content: unknown[]): boolean {
  return content.some((block) => isRecord(block) && block.type === "tool_use");
}

const NON_RETRYABLE_ANTHROPIC_STATUSES = new Set([
  400, 401, 403, 404, 413, 422,
]);
const HALT_AFTER_FAILURE =
  "Not executed: an earlier computer action in this turn failed.";
const NO_ACTION_RESULT = "Not executed: no result was received for this action.";

export interface StepNotifier {
  sendQuestion(
    task: AgentTaskRecord,
    question: string,
    idempotencyKey: string,
  ): Promise<void>;
  sendProgress?(
    task: AgentTaskRecord,
    text: string,
    idempotencyKey: string,
  ): Promise<void>;
  sendResult(
    task: AgentTaskRecord,
    text: string,
    mediaUrl: string | undefined,
    idempotencyKey: string,
  ): Promise<void>;
}

export interface RunAgentStepOptions {
  store: TaskStore;
  deviceId: string;
  request: MacStepRequest;
  callClaude: CallClaude;
  notifier?: StepNotifier;
  profiles?: Pick<OnboardingStore, "getProfile">;
  model?: string;
  now?: () => Date;
  clock?: () => number;
  linkSecret?: string;
  publicUrl?: string;
  /**
   * Runs work after the response has been sent (Vercel's `waitUntil`), so the Mac gets its
   * next actions without waiting for a text to go out. Without it, notifications are awaited.
   */
  defer?: (work: Promise<void>) => void;
}

type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
  toolset_name?: "computer";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function imageBlock(request: MacStepRequest): Record<string, unknown> {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: request.screenshot.mediaType,
      data: request.screenshot.data,
    },
  };
}

function getToolUses(content: unknown): ToolUse[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const blocks = content.filter(
    (block): block is Record<string, unknown> =>
      isRecord(block) && block.type === "tool_use",
  );
  return blocks.map((block) => {
    if (
      typeof block.id !== "string" ||
      block.id.length === 0 ||
      typeof block.name !== "string" ||
      block.name.length === 0
    ) {
      throw new Error("Claude returned a tool use without an id or name");
    }
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input,
      ...(typeof block.toolset_name === "string"
        ? { toolset_name: block.toolset_name }
        : {}),
    };
  });
}

function assistantText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (block): block is Record<string, unknown> =>
        isRecord(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text as string)
    .join("\n")
    .slice(0, MAX_SUMMARY_CHARS);
}

function isActionTool(toolUse: ToolUse): boolean {
  return (
    toolUse.toolset_name === "computer" ||
    (toolUse.toolset_name === undefined &&
      (toolUse.name === "open_app" || toolUse.name === "open_url"))
  );
}

function toolResult(
  toolUse: ToolUse,
  content: unknown,
  isError = false,
): ToolResultBlock {
  return {
    type: "tool_result",
    tool_use_id: toolUse.id,
    content,
    ...(isError ? { is_error: true } : {}),
    ...(toolUse.toolset_name === "computer"
      ? { toolset_name: "computer" as const }
      : {}),
  };
}

function findPendingResult(
  pending: unknown[],
  toolUseId: string,
): ToolResultBlock | undefined {
  return pending.find(
    (result): result is ToolResultBlock =>
      isRecord(result) &&
      result.type === "tool_result" &&
      result.tool_use_id === toolUseId,
  );
}

function buildPreviousTurnMessage(
  task: AgentTaskRecord,
  request: MacStepRequest,
  inbound: PendingInboundMessage[],
): { message: AgentMessage; consumedInboundIds: string[] } {
  const previousAssistant = [...task.agentMessages]
    .reverse()
    .find((message) => message.role === "assistant");
  const toolUses = previousAssistant
    ? getToolUses(previousAssistant.content)
    : [];
  const resultById = new Map(
    request.results.map((result) => [result.actionId, result]),
  );
  const content: unknown[] = [];
  let earlierActionFailed = false;
  let screenshotIncluded = false;

  for (let index = 0; index < toolUses.length; index += 1) {
    const use = toolUses[index]!;
    const pendingResult = findPendingResult(task.pendingToolResults, use.id);
    if (pendingResult) {
      content.push(pendingResult);
      if (isActionTool(use) && pendingResult.is_error) {
        earlierActionFailed = true;
      }
      continue;
    }

    if (use.name === "ask_user" && use.toolset_name === undefined) {
      const answers = inbound
        .filter((message) => message.kind === "answer")
        .map((message) => message.text);
      if (answers.length > 0) {
        content.push(
          toolResult(
            use,
            `The user replied: "${answers.join("\n")}"`,
          ),
        );
      } else {
        content.push(
          toolResult(use, "Not executed: no user reply was received.", true),
        );
      }
      continue;
    }

    if (isActionTool(use) && earlierActionFailed) {
      content.push(toolResult(use, HALT_AFTER_FAILURE, true));
      continue;
    }

    const result = resultById.get(use.id);
    if (use.toolset_name === "computer" && use.name === "screenshot") {
      if (!result) {
        content.push(toolResult(use, NO_ACTION_RESULT, true));
        earlierActionFailed = true;
      } else if (!result.ok) {
        content.push(
          toolResult(use, result.error ?? "The Mac screenshot failed.", true),
        );
        earlierActionFailed = true;
      } else if (index === toolUses.length - 1) {
        content.push(toolResult(use, [imageBlock(request)]));
        screenshotIncluded = true;
      } else {
        content.push(toolResult(use, "OK"));
      }
      continue;
    }

    if (!result) {
      content.push(toolResult(use, NO_ACTION_RESULT, true));
      if (isActionTool(use)) {
        earlierActionFailed = true;
      }
      continue;
    }

    if (!result.ok) {
      content.push(
        toolResult(
          use,
          result.error ?? "The Mac action failed.",
          true,
        ),
      );
      if (isActionTool(use)) {
        earlierActionFailed = true;
      }
    } else {
      content.push(toolResult(use, result.output ?? "OK"));
    }
  }

  const answers = inbound.filter((message) => message.kind === "answer");
  const corrections = inbound.filter(
    (message) => message.kind === "correction",
  );
  if (answers.length > 0 && !toolUses.some((use) => use.name === "ask_user")) {
    content.push({
      type: "text",
      text: `The user replied: "${answers.map((message) => message.text).join("\n")}"`,
    });
  }
  for (const correction of corrections) {
    content.push({
      type: "text",
      text: `The user sent a correction: "${correction.text}"`,
    });
  }
  if (!screenshotIncluded) {
    content.push({ type: "text", text: "Current screen:" });
    content.push(imageBlock(request));
  }

  return {
    message: { role: "user", content },
    consumedInboundIds: inbound.map((message) => message.providerMessageId),
  };
}

function terminalResponse(
  task: AgentTaskRecord,
  summary = task.summary ?? "",
): MacStepResponse {
  const state =
    task.state === "succeeded" ||
    task.state === "failed" ||
    task.state === "cancelled"
      ? task.state
      : "failed";
  return MacStepResponseSchema.parse({
    kind: "finished",
    taskId: task.taskId,
    step: task.stepCount,
    state,
    summary,
  });
}

function finishedResponse(
  taskId: string,
  step: number,
  state: "succeeded" | "failed" | "cancelled",
  summary: string,
): MacStepResponse {
  return MacStepResponseSchema.parse({
    kind: "finished",
    taskId,
    step,
    state,
    summary: summary.slice(0, MAX_SUMMARY_CHARS),
  });
}

function waitingResponse(
  taskId: string,
  step: number,
  question: string,
): MacStepResponse {
  return MacStepResponseSchema.parse({
    kind: "waiting",
    taskId,
    step,
    question,
  });
}

function taskScreenshot(request: MacStepRequest): Uint8Array {
  return Buffer.from(request.screenshot.data, "base64");
}

function signedScreenshotUrl(
  taskId: string,
  secret: string,
  publicUrl: string,
): string {
  const signature = createHmac("sha256", secret)
    .update(taskId)
    .digest("hex");
  return `${publicUrl.replace(/\/+$/u, "")}/api/tasks/screenshot?task=${encodeURIComponent(taskId)}&sig=${signature}`;
}

async function persist(
  options: RunAgentStepOptions,
  task: AgentTaskRecord,
  response: MacStepResponse,
  input: {
    messages: AgentMessage[];
    pendingToolResults: unknown[];
    state: AgentTaskRecord["state"];
    question: string | null;
    summary: string | null;
    consumedInboundIds: string[];
    stepCount: number;
  },
): Promise<MacStepResponse> {
  // Append-only: never rewrite earlier turns. Opus 5.5 rejects replayed
  // thinking blocks after an edited history on newer accounts.
  const savedMessages = input.messages;
  const updated = await options.store.persistAgentStep({
    taskId: task.taskId,
    expectedStepCount: task.stepCount,
    expectedRevision: task.revision,
    stepCount: input.stepCount,
    state: input.state,
    question: input.question,
    agentMessages: savedMessages,
    pendingToolResults: input.pendingToolResults,
    lastStepResponse: response,
    screenWidth: options.request.screenshot.width,
    screenHeight: options.request.screenshot.height,
    summary: input.summary,
    finalScreenshot:
      response.kind === "finished"
        ? taskScreenshot(options.request)
        : task.finalScreenshot,
    finalScreenshotType:
      response.kind === "finished"
        ? options.request.screenshot.mediaType
        : task.finalScreenshotType,
    consumedInboundIds: input.consumedInboundIds,
    now: (options.now ?? (() => new Date()))(),
  });
  if (updated) {
    return response;
  }
  const latest = await options.store.getTaskForDevice(
    task.taskId,
    options.deviceId,
  );
  if (latest?.state === "cancelled") {
    return terminalResponse(latest, latest.summary ?? "Stopped.");
  }
  throw apiError(
    409,
    "staleStep",
    "The task changed while this step was being processed.",
    latest?.revision ?? task.revision,
  );
}

/** Notifications never throw (the *Safely wrappers log instead), so deferring is safe. */
function later(options: RunAgentStepOptions, work: Promise<void>): Promise<void> {
  if (!options.defer) return work;
  options.defer(work);
  return Promise.resolve();
}

async function notifyQuestion(
  options: RunAgentStepOptions,
  task: AgentTaskRecord,
  question: string,
  step: number,
): Promise<void> {
  if (!options.notifier) {
    return;
  }
  await options.notifier.sendQuestion(
    task,
    question,
    `question-${task.taskId}-${step}`,
  );
}

async function notifyResult(
  options: RunAgentStepOptions,
  taskId: string,
  summary: string,
  state: "succeeded" | "failed",
  attachScreenshot: boolean,
): Promise<void> {
  const notifier = options.notifier;
  if (!notifier || (attachScreenshot && !options.linkSecret)) {
    return;
  }
  const claimed = await options.store.claimResultNotification(
    taskId,
    (options.now ?? (() => new Date()))(),
  );
  if (!claimed) {
    return;
  }
  if (claimed.replyProvider !== "sendblue") {
    console.info(`Skipping result notification for provider ${claimed.replyProvider ?? "unknown"}`);
    return;
  }
  if (!claimed.replyHandle) {
    return;
  }
  // Worded by the persona: a success is the summary itself; a failure says so calmly.
  const text = status(state === "succeeded" ? "done" : "failed", { summary });
  const baseUrl =
    options.publicUrl ?? "https://spectr-api.vercel.app";
  const mediaUrl =
    attachScreenshot && options.linkSecret
      ? signedScreenshotUrl(taskId, options.linkSecret, baseUrl)
      : undefined;
  await notifier.sendResult(
    claimed,
    text,
    mediaUrl,
    `result-${taskId}`,
  );
}

function notificationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

async function notifyQuestionSafely(
  options: RunAgentStepOptions,
  task: AgentTaskRecord,
  question: string,
  step: number,
): Promise<void> {
  try {
    await notifyQuestion(options, task, question, step);
  } catch (error) {
    console.error(
      "Question notification failed",
      notificationErrorMessage(error),
    );
  }
}

async function notifyResultSafely(
  options: RunAgentStepOptions,
  taskId: string,
  summary: string,
  state: "succeeded" | "failed",
  attachScreenshot: boolean,
): Promise<void> {
  try {
    await notifyResult(options, taskId, summary, state, attachScreenshot);
  } catch (error) {
    console.error(
      "Result notification failed",
      notificationErrorMessage(error),
    );
  }
}

async function loadEarlierTurns(options: RunAgentStepOptions, task: AgentTaskRecord): Promise<SessionTurn[]> {
  return (await options.store.getEarlierSessionTurns?.(task).catch(() => [])) ?? [];
}

/** Earlier tasks in this chat, so a resumed chat can refer back to them. */
export function sessionContext(turns: SessionTurn[]): string | null {
  if (turns.length === 0) return null;
  const lines = turns.slice(-6).map((turn, index) => {
    const result = turn.summary ? ` Result (${turn.state}): ${turn.summary}` : ` It ended as ${turn.state}.`;
    return `${index + 1}. The user asked: "${turn.instruction}".${result}`;
  });
  return [
    "This continues an earlier chat with the user. Earlier in this chat:",
    ...lines,
    "Use this only as background for the new task; check the current screen before acting.",
  ].join("\n");
}

async function loadProfile(options: RunAgentStepOptions, ownerId: string) {
  return (await options.profiles?.getProfile(ownerId).catch(() => null)) ?? null;
}

async function sendProgressSafely(
  options: RunAgentStepOptions,
  task: AgentTaskRecord,
  response: MacStepResponse,
): Promise<void> {
  if (!options.notifier?.sendProgress || response.kind !== "actions") return;
  try {
    const profile = await loadProfile(options, task.ownerId);
    if (!shouldSendProgress(profile?.updates ?? null, response.step)) return;
    await options.notifier.sendProgress(
      task,
      statusForResponse(response),
      `progress-${task.taskId}-${response.step}`,
    );
  } catch (error) {
    console.error("Progress notification failed", notificationErrorMessage(error));
  }
}

function upstreamError(revision: number): ApiErrorException {
  return new ApiErrorException(502, {
    error: {
      code: "upstreamError",
      message: "Claude is temporarily unavailable; retry this step.",
      currentRevision: revision,
    },
  });
}

function requestWithMessages(
  messages: AgentMessage[],
  model?: string,
): AnthropicRequest {
  return anthropicRequest(messages, model);
}

function isControlTool(toolUse: ToolUse): boolean {
  return (
    toolUse.toolset_name === undefined &&
    (toolUse.name === "finish" || toolUse.name === "ask_user")
  );
}

export async function runAgentStep(
  options: RunAgentStepOptions,
): Promise<MacStepResponse> {
  const clock = options.clock ?? Date.now;
  const deadline = clock() + REQUEST_DEADLINE_MS;
  const task = await options.store.getTaskForDevice(
    options.request.taskId,
    options.deviceId,
  );
  if (!task) {
    throw apiError(404, "notFound", "Task not found.");
  }
  if (
    task.state === "succeeded" ||
    task.state === "failed" ||
    task.state === "cancelled"
  ) {
    return task.lastStepResponse?.kind === "finished"
      ? task.lastStepResponse
      : terminalResponse(task);
  }
  if (task.state === "waitingForUser") {
    return waitingResponse(
      task.taskId,
      task.stepCount,
      task.question ?? "",
    );
  }
  if (
    task.stepCount > 0 &&
    options.request.afterStep === task.stepCount - 1 &&
    task.lastStepResponse
  ) {
    return task.lastStepResponse;
  }
  if (options.request.afterStep !== task.stepCount) {
    throw apiError(
      409,
      "staleStep",
      `Expected step ${task.stepCount}, received ${options.request.afterStep}.`,
      task.revision,
    );
  }

  const inbound = await options.store.getUnconsumedInboundMessages(task.taskId);
  const consumedInboundIds = inbound.map((message) => message.providerMessageId);
  if (task.stepCount >= MAX_AGENT_STEPS) {
    const summary = "I'm afraid that took too many steps, so I've stopped.";
    const messages = task.agentMessages;
    const response = finishedResponse(
      task.taskId,
      task.stepCount,
      "failed",
      summary,
    );
    const saved = await persist(options, task, response, {
      messages,
      pendingToolResults: [],
      state: "failed",
      question: null,
      summary,
      consumedInboundIds,
      stepCount: task.stepCount,
    });
    if (saved.kind === "finished" && saved.state === "failed") {
      await later(options, notifyResultSafely(options, task.taskId, summary, "failed", true));
    }
    return saved;
  }

  let messages: AgentMessage[];
  let consumed: string[] = [];
  if (task.agentMessages.length === 0) {
    const firstTurnContent: unknown[] = [
      {
        type: "text",
        text: `Task from the user: "${task.instruction}"\nCurrent screen:`,
      },
    ];
    for (const inboundMessage of inbound) {
      if (inboundMessage.kind === "correction") {
        firstTurnContent.push({
          type: "text",
          text: `The user sent a correction: "${inboundMessage.text}"`,
        });
      } else if (inboundMessage.kind === "answer") {
        firstTurnContent.push({
          type: "text",
          text: `The user replied: "${inboundMessage.text}"`,
        });
      }
    }
    const earlier = sessionContext(await loadEarlierTurns(options, task));
    if (earlier) firstTurnContent.unshift({ type: "text", text: earlier });
    const note = profileContext(await loadProfile(options, task.ownerId));
    if (note) firstTurnContent.unshift({ type: "text", text: note });
    firstTurnContent.push(imageBlock(options.request));
    messages = [{ role: "user", content: firstTurnContent }];
    consumed = inbound.map((message) => message.providerMessageId);
  } else {
    const next = buildPreviousTurnMessage(task, options.request, inbound);
    messages = [...task.agentMessages, next.message];
    consumed = next.consumedInboundIds;
  }

  let noToolUseRetried = false;
  let lastAssistantContent: unknown = [];
  for (
    let callIndex = 0;
    callIndex < MAX_CLAUDE_CALLS_PER_STEP;
    callIndex += 1
  ) {
    const remainingMs = deadline - clock();
    if (remainingMs < MINIMUM_CALL_WINDOW_MS) {
      throw upstreamError(task.revision);
    }
    const timeoutMs = Math.min(
      CLAUDE_TIMEOUT_MS,
      remainingMs - CLAUDE_TIMEOUT_BUFFER_MS,
    );
    let response: AnthropicResponse;
    try {
      response = await options.callClaude(
        requestWithMessages(messages, options.model),
        { timeoutMs },
      );
    } catch (error) {
      if (
        error instanceof AnthropicHttpError &&
        NON_RETRYABLE_ANTHROPIC_STATUSES.has(error.status)
      ) {
        const summary = `I'm afraid something went wrong on our end (error ${error.status}).`;
        const finished = finishedResponse(
          task.taskId,
          task.stepCount + 1,
          "failed",
          summary,
        );
        const saved = await persist(options, task, finished, {
          messages,
          pendingToolResults: [],
          state: "failed",
          question: null,
          summary,
          consumedInboundIds: consumed,
          stepCount: task.stepCount + 1,
        });
        await later(options, notifyResultSafely(options, task.taskId, summary, "failed", true));
        return saved;
      }
      throw upstreamError(task.revision);
    }
    if (!response || !Array.isArray(response.content)) {
      throw apiError(
        502,
        "upstreamError",
        "Claude returned an invalid response; retry this step.",
        task.revision,
      );
    }
    lastAssistantContent = response.content;
    const assistantMessage: AgentMessage = {
      role: "assistant",
      content: response.content,
    };
    messages.push(assistantMessage);

    // A refusal or a cut-off reply can't be fixed by asking again in this step.
    const stopReason = response.stop_reason ?? null;
    if (stopReason === "refusal" || (stopReason === "max_tokens" && !hasToolUse(response.content))) {
      if (stopReason === "refusal") {
        console.warn("Claude declined task", task.taskId, response.stop_details?.category ?? "unknown");
      }
      const summary = stopReason === "refusal" ? REFUSAL_SUMMARY : CUT_OFF_SUMMARY;
      const finished = finishedResponse(task.taskId, task.stepCount + 1, "failed", summary);
      const saved = await persist(options, task, finished, {
        messages,
        pendingToolResults: [],
        state: "failed",
        question: null,
        summary,
        consumedInboundIds: consumed,
        stepCount: task.stepCount + 1,
      });
      await later(options, notifyResultSafely(options, task.taskId, summary, "failed", true));
      return saved;
    }

    let toolUses: ToolUse[];
    try {
      toolUses = getToolUses(response.content);
    } catch {
      throw apiError(
        502,
        "upstreamError",
        "Claude returned an invalid tool response; retry this step.",
        task.revision,
      );
    }

    if (toolUses.length === 0) {
      if (!noToolUseRetried) {
        noToolUseRetried = true;
        messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: "Call finish to report the result, or continue with actions.",
            },
          ],
        });
        continue;
      }
      const summary =
        assistantText(response.content) || "I'm afraid something went wrong on our end.";
      const failureSummary = summary.slice(0, MAX_SUMMARY_CHARS);
      const finished = finishedResponse(
        task.taskId,
        task.stepCount + 1,
        "failed",
        failureSummary,
      );
      const saved = await persist(options, task, finished, {
        messages,
        pendingToolResults: [],
        state: "failed",
        question: null,
        summary: failureSummary,
        consumedInboundIds: consumed,
        stepCount: task.stepCount + 1,
      });
      await later(options, notifyResultSafely(
        options,
        task.taskId,
        failureSummary,
        "failed",
        true,
      ));
      return saved;
    }

    const controls = toolUses.filter(isControlTool);
    if (controls.length > 0 && toolUses.length > 1) {
      const content = toolUses.map((toolUse) =>
        toolResult(
          toolUse,
          `Call ${toolUse.name} by itself in its own turn.`,
          true,
        ),
      );
      messages.push({ role: "user", content });
      continue;
    }

    if (toolUses.length === 1 && controls.length === 1) {
      const toolUse = toolUses[0]!;
      let mapped: ReturnType<typeof mapToolUse>;
      try {
        mapped = mapToolUse(toolUse, {
          width: options.request.screenshot.width,
          height: options.request.screenshot.height,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid tool input";
        messages.push({
          role: "user",
          content: [toolResult(toolUse, message, true)],
        });
        continue;
      }
      if (mapped.kind === "ask_user") {
        const question = mapped.question.slice(0, 1000);
        const waiting = waitingResponse(
          task.taskId,
          task.stepCount + 1,
          question,
        );
        const saved = await persist(options, task, waiting, {
          messages,
          pendingToolResults: [],
          state: "waitingForUser",
          question,
          summary: null,
          consumedInboundIds: consumed,
          stepCount: task.stepCount + 1,
        });
        await later(options, notifyQuestionSafely(
          options,
          task,
          question,
          task.stepCount + 1,
        ));
        return saved;
      }
      if (mapped.kind === "finish") {
        // Keynote example tasks: if the Mac reports the slide showing and it
        // isn't the one asked for, Claude's "done" doesn't count.
        const target = mapped.success ? targetSlide(messages) : null;
        const observed = options.request.observedSlide ?? null;
        const mismatch = target != null && observed != null && observed !== target;
        const state = mapped.success && !mismatch ? "succeeded" : "failed";
        const summary = (mismatch ? slideMismatchSummary(target, observed) : mapped.summary).slice(0, MAX_SUMMARY_CHARS);
        const finished = finishedResponse(
          task.taskId,
          task.stepCount + 1,
          state,
          summary,
        );
        const saved = await persist(options, task, finished, {
          messages,
          pendingToolResults: [],
          state,
          question: null,
          summary,
          consumedInboundIds: consumed,
          stepCount: task.stepCount + 1,
        });
        await later(options, notifyResultSafely(
          options,
          task.taskId,
          summary,
          state,
          state === "succeeded" ? mapped.attachScreenshot : true,
        ));
        return saved;
      }
    }

    const actions: Array<{ actionId: string; action: MacAction }> = [];
    const pendingResults: ToolResultBlock[] = [];
    let invalid = false;
    for (let index = 0; index < toolUses.length; index += 1) {
      const toolUse = toolUses[index]!;
      if (invalid) {
        pendingResults.push(toolResult(toolUse, HALT_AFTER_FAILURE, true));
        continue;
      }
      try {
        const mapped = mapToolUse(toolUse, {
          width: options.request.screenshot.width,
          height: options.request.screenshot.height,
        });
        if (mapped.kind === "risky_action") {
          // Enforced here, not in the prompt: the earlier turns (without this
          // one) must hold a yes for this exact action.
          if (hasApproval(messages.slice(0, -1), mapped.action)) {
            pendingResults.push(toolResult(toolUse, "Approved."));
          } else {
            pendingResults.push(toolResult(toolUse, blockedMessage(mapped.action), true));
            invalid = true;
          }
          continue;
        }
        if (mapped.kind !== "action") {
          throw new Error("Control tools must be called by themselves");
        }
        actions.push({ actionId: toolUse.id, action: mapped.action });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid tool input";
        pendingResults.push(toolResult(toolUse, message, true));
        invalid = true;
      }
    }

    if (actions.length > 0) {
      const actionResponse = MacStepResponseSchema.parse({
        kind: "actions",
        taskId: task.taskId,
        step: task.stepCount + 1,
        revision: task.revision,
        actions,
      });
      const saved = await persist(options, task, actionResponse, {
        messages,
        pendingToolResults: pendingResults,
        state: "running",
        question: null,
        summary: null,
        consumedInboundIds: consumed,
        stepCount: task.stepCount + 1,
      });
      if (saved === actionResponse) await later(options, sendProgressSafely(options, task, saved));
      return saved;
    }

    messages.push({
      role: "user",
      content: [
        ...pendingResults,
        { type: "text", text: "Current screen:" },
        imageBlock(options.request),
      ],
    });
  }

  const summary =
    assistantText(lastAssistantContent) ||
    "I'm afraid something went wrong on our end.";
  const failureSummary = summary.slice(0, MAX_SUMMARY_CHARS);
  const finished = finishedResponse(
    task.taskId,
    task.stepCount + 1,
    "failed",
    failureSummary,
  );
  const saved = await persist(options, task, finished, {
    messages,
    pendingToolResults: [],
    state: "failed",
    question: null,
    summary: failureSummary,
    consumedInboundIds: consumed,
    stepCount: task.stepCount + 1,
  });
  await later(options, notifyResultSafely(
    options,
    task.taskId,
    failureSummary,
    "failed",
    true,
  ));
  return saved;
}
