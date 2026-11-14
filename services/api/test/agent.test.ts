import { createHmac } from "node:crypto";
import {
  MacStepRequestSchema,
  type MacStepRequest,
} from "../src/contracts.js";
import {
  createAnthropicCaller,
  type AnthropicRequest,
  type AnthropicResponse,
  type CallClaude,
} from "../src/agent/anthropic.js";
import { ApiErrorException } from "../src/agent/errors.js";
import { SYSTEM_PROMPT } from "../src/agent/prompt.js";
import {
  MAX_AGENT_STEPS,
  runAgentStep,
  type StepNotifier,
} from "../src/agent/step.js";
import {
  ANTHROPIC_TOOLS,
  MAX_SUMMARY_CHARS,
  mapToolUse,
  type ToolUse,
} from "../src/agent/tools.js";
import { InMemoryTaskStore } from "../src/memory-store.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const deviceId = "dev_test_mac";
const ownerId = "owner_test";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(
  taskId: string,
  overrides: Partial<MacStepRequest> = {},
): MacStepRequest {
  return MacStepRequestSchema.parse({
    taskId,
    afterStep: 0,
    screenshot: {
      mediaType: "image/png",
      data: "aGVsbG8=",
      width: 100,
      height: 100,
    },
    results: [],
    ...overrides,
  });
}

async function createTask(
  store: InMemoryTaskStore,
  text = "Open Instagram",
): Promise<string> {
  const routed = await store.routeInbound({
    providerMessageId: `msg-${Math.random()}`,
    ownerId,
    deviceId,
    text,
    replyProvider: "sendblue",
    replyHandle: "+15555550100",
    now: new Date(),
  });
  return routed.taskId;
}

function memberTool(
  id: string,
  name: string,
  input: unknown,
): ToolUse {
  return { type: "tool_use", id, name, input, toolset_name: "computer" };
}

function customTool(id: string, name: string, input: unknown): ToolUse {
  return { type: "tool_use", id, name, input };
}

function claudeResponse(...content: unknown[]): AnthropicResponse {
  return { content };
}

function fakeClaude(...responses: AnthropicResponse[]): CallClaude {
  const queue = [...responses];
  return vi.fn(async (_body: AnthropicRequest) => {
    const response = queue.shift();
    if (!response) {
      throw new Error("Unexpected Claude call");
    }
    return response;
  });
}

function getLastUserMessage(body: AnthropicRequest) {
  return [...body.messages].reverse().find((message) => message.role === "user");
}

function flattenText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(flattenText).join("\n");
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return [
      typeof record.text === "string" ? record.text : "",
      flattenText(record.content),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function countImages(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countImages(item), 0);
  }
  if (typeof value !== "object" || value === null) {
    return 0;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.type === "image" ? 1 : 0) +
    Object.values(record).reduce<number>(
      (count, item) => count + countImages(item),
      0,
    )
  );
}

function makeNotifier(): StepNotifier {
  return {
    sendQuestion: vi.fn(
      async (
        _task: Parameters<StepNotifier["sendQuestion"]>[0],
        _question: string,
        _idempotencyKey: string,
      ) => {},
    ),
    sendResult: vi.fn(
      async (
        _task: Parameters<StepNotifier["sendResult"]>[0],
        _text: string,
        _mediaUrl: string | undefined,
        _idempotencyKey: string,
      ) => {},
    ),
  };
}

describe("Claude computer-use tool mapping", () => {
  it("maps every enabled member and custom action into a MacAction", () => {
    const screen = { width: 100, height: 100 };
    const cases: Array<[ToolUse, string]> = [
      [memberTool("screenshot", "screenshot", {}), "screenshot"],
      [
        memberTool("left", "left_click", {
          coordinate: [10, 20],
          text: "super+shift",
        }),
        "click",
      ],
      [
        memberTool("right", "right_click", { coordinate: [10, 20] }),
        "click",
      ],
      [
        memberTool("middle", "middle_click", { coordinate: [10, 20] }),
        "click",
      ],
      [
        memberTool("double", "double_click", { coordinate: [10, 20] }),
        "click",
      ],
      [
        memberTool("triple", "triple_click", { coordinate: [10, 20] }),
        "click",
      ],
      [
        memberTool("drag", "left_click_drag", {
          start_coordinate: [1, 2],
          coordinate: [3, 4],
          text: "ctrl",
        }),
        "drag",
      ],
      [
        memberTool("move", "mouse_move", { coordinate: [5, 6] }),
        "mouseMove",
      ],
      [
        memberTool("scroll", "scroll", {
          scroll_direction: "down",
          scroll_amount: 5,
          coordinate: [7, 8],
          text: "alt",
        }),
        "scroll",
      ],
      [memberTool("type", "type", { text: "hello" }), "type"],
      [memberTool("key", "key", { text: "super+l" }), "key"],
      [memberTool("plus", "key", { text: "+" }), "key"],
      [memberTool("wait", "wait", { duration: 2 }), "wait"],
      [customTool("app", "open_app", { name: "Safari" }), "openApp"],
      [
        customTool("url", "open_url", { url: "instagram.com" }),
        "openUrl",
      ],
    ];

    for (const [toolUse, expectedType] of cases) {
      const mapped = mapToolUse(toolUse, screen);
      expect(mapped.kind).toBe("action");
      if (mapped.kind !== "action") {
        throw new Error("Expected a mapped computer action");
      }
      expect(mapped.action.type).toBe(expectedType);
    }
    expect(
      mapToolUse(memberTool("key", "key", { text: "super+l" }), screen),
    ).toMatchObject({
      kind: "action",
      action: { type: "key", keys: "cmd+l", repeat: 1 },
    });
    expect(
      mapToolUse(memberTool("plus", "key", { text: "+" }), screen),
    ).toMatchObject({
      kind: "action",
      action: { type: "key", keys: "+", repeat: 1 },
    });
    expect(
      mapToolUse(
        customTool("url", "open_url", { url: "instagram.com/direct" }),
        screen,
      ),
    ).toMatchObject({
      kind: "action",
      action: {
        type: "openUrl",
        url: "https://instagram.com/direct",
      },
    });
  });

  it("rejects unsupported keys, unsafe URLs, invalid waits, and bad coordinates", () => {
    const screen = { width: 100, height: 100 };
    expect(() =>
      mapToolUse(memberTool("key", "key", { text: "super+launch" }), screen),
    ).toThrow(/Unknown key/u);
    expect(() =>
      mapToolUse(memberTool("click", "left_click", {
        coordinate: [100, 10],
      }), screen),
    ).toThrow(/outside/u);
    expect(() =>
      mapToolUse(customTool("js", "open_url", {
        url: "javascript:alert(1)",
      }), screen),
    ).toThrow(/Only http and https/u);
    expect(() =>
      mapToolUse(customTool("file", "open_url", {
        url: "file:///etc/passwd",
      }), screen),
    ).toThrow(/Only http and https/u);
    expect(() =>
      mapToolUse(memberTool("wait", "wait", { duration: 30 }), screen),
    ).toThrow();
    expect(() =>
      mapToolUse(memberTool("click", "left_click", {}), screen),
    ).toThrow(/coordinate/u);
    expect(() =>
      mapToolUse(memberTool("disabled", "zoom", {}), screen),
    ).toThrow(/Unknown computer tool/u);
    expect(() =>
      mapToolUse(customTool("unknown", "unknown_tool", {}), screen),
    ).toThrow(/Unknown custom tool/u);
  });

  it("maps the optional screenshot flag and rejects non-boolean values", () => {
    const screen = { width: 100, height: 100 };
    const finishTool = ANTHROPIC_TOOLS.find(
      (tool) => "name" in tool && tool.name === "finish",
    );

    expect(finishTool).toMatchObject({
      description: "Report the result of the task. The summary is texted to the user.",
      input_schema: {
        required: ["success", "summary"],
        properties: {
          attach_screenshot: {
            type: "boolean",
            description: "True only when the screen itself is what the user wants to see.",
          },
        },
      },
    });
    expect(
      mapToolUse(
        customTool("finish-1", "finish", {
          success: true,
          summary: "Done.",
          attach_screenshot: true,
        }),
        screen,
      ),
    ).toMatchObject({ kind: "finish", attachScreenshot: true });
    expect(
      mapToolUse(
        customTool("finish-2", "finish", {
          success: true,
          summary: "Done.",
        }),
        screen,
      ),
    ).toMatchObject({ kind: "finish", attachScreenshot: false });
    expect(() =>
      mapToolUse(
        customTool("finish-3", "finish", {
          success: true,
          summary: "Done.",
          attach_screenshot: "yes",
        }),
        screen,
      ),
    ).toThrow("attach_screenshot must be a boolean");
  });
});

describe("Anthropic Messages caller", () => {
  it("uses the Messages API headers and timeout without an API request", async () => {
    const fetcher = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) => new Response(JSON.stringify({ content: [] }), { status: 200 }),
    );
    const caller = createAnthropicCaller("test-api-key", fetcher);
    const timeoutSignal = new AbortController().signal;
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);
    await caller({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: ANTHROPIC_TOOLS,
      messages: [],
    }, { timeoutMs: 12_345 });

    const [url, init] = fetcher.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.method).toBe("POST");
    expect(headers).toEqual({
      "x-api-key": "test-api-key",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    expect(headers).not.toHaveProperty("anthropic-beta");
    expect(init?.signal).toBe(timeoutSignal);
    expect(timeout).toHaveBeenCalledWith(12_345);
    expect(body.max_tokens).toBe(4096);
  });
});

describe("runAgentStep", () => {
  it("sends the prompt, toolset, instruction, and image on the first request", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const callClaude = fakeClaude(
      claudeResponse(
        memberTool("click-1", "left_click", { coordinate: [10, 20] }),
      ),
    );
    const response = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
    });
    const body = vi.mocked(callClaude).mock.calls[0]?.[0];

    expect(response).toMatchObject({
      kind: "actions",
      taskId,
      step: 1,
      actions: [{ actionId: "click-1" }],
    });
    expect(body?.system).toBe(SYSTEM_PROMPT);
    expect(body?.model).toBe("claude-opus-5-5");
    expect(body?.max_tokens).toBe(4096);
    expect(body?.tools[0]).toEqual({
      type: "computer_toolset_20260801",
      configs: {
        zoom: { enabled: false },
        left_mouse_down: { enabled: false },
        left_mouse_up: { enabled: false },
        cursor_position: { enabled: false },
        hold_key: { enabled: false },
      },
    });
    expect(ANTHROPIC_TOOLS.slice(1).map((tool) =>
      "name" in tool ? tool.name : "",
    )).toEqual(["open_app", "open_url", "ask_user", "finish"]);
    expect(flattenText(body?.messages[0]?.content)).toContain(
      'Task from the user: "Open Instagram"',
    );
    expect(countImages(body?.messages[0]?.content)).toBe(1);
    expect(response.kind === "actions" && response.actions[0]?.actionId).toBe(
      "click-1",
    );
  });

  it("matches every previous tool use and emits member/custom results correctly", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const callClaude = fakeClaude(
      claudeResponse(
        memberTool("click-1", "left_click", { coordinate: [10, 20] }),
        customTool("app-1", "open_app", { name: "Safari" }),
      ),
      claudeResponse(customTool("finish-1", "finish", {
        success: true,
        summary: "Safari is open.",
      })),
    );
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
    });
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId, {
        afterStep: 1,
        results: [{ actionId: "click-1", ok: false, error: "Click failed" }],
      }),
      callClaude,
    });
    const body = vi.mocked(callClaude).mock.calls[1]?.[0];
    const userContent = getLastUserMessage(body!)?.content as unknown[];
    const results = userContent.filter(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "tool_result",
    ) as Array<Record<string, unknown>>;

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      tool_use_id: "click-1",
      toolset_name: "computer",
      content: "Click failed",
      is_error: true,
    });
    expect(results[1]).toMatchObject({
      tool_use_id: "app-1",
      content: "Not executed: an earlier computer action in this turn failed.",
      is_error: true,
    });
    expect(results[1]).not.toHaveProperty("toolset_name");
  });

  it("uses a fresh screenshot result only when screenshot is the last tool use", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const callClaude = fakeClaude(
      claudeResponse(
        memberTool("screen-1", "screenshot", {}),
        memberTool("click-1", "left_click", { coordinate: [10, 20] }),
      ),
      claudeResponse(customTool("finish-1", "finish", {
        success: true,
        summary: "Done.",
      })),
    );
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
    });
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId, {
        afterStep: 1,
        results: [
          { actionId: "screen-1", ok: true, output: "ignored" },
          { actionId: "click-1", ok: true, output: "ignored" },
        ],
      }),
      callClaude,
    });
    const userContent = getLastUserMessage(
      vi.mocked(callClaude).mock.calls[1]![0],
    )?.content as unknown[];
    const screenshotResult = userContent.find(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).tool_use_id === "screen-1",
    ) as Record<string, unknown>;

    expect(screenshotResult.content).toBe("OK");
    expect(countImages(userContent)).toBe(1);
  });

  it("retries an invalid action with its error and returns the valid retry", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const callClaude = fakeClaude(
      claudeResponse(
        memberTool("invalid-click", "left_click", {
          coordinate: [100, 20],
        }),
      ),
      claudeResponse(
        memberTool("valid-click", "left_click", {
          coordinate: [10, 20],
        }),
      ),
    );
    const response = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
    });
    const retryBody = vi.mocked(callClaude).mock.calls[1]?.[0];

    expect(response).toMatchObject({
      kind: "actions",
      actions: [{ actionId: "valid-click" }],
    });
    expect(
      flattenText(getLastUserMessage(retryBody!)?.content).toLowerCase(),
    ).toContain("coordinate is outside the latest screenshot");
    const content = getLastUserMessage(retryBody!)?.content as unknown[];
    expect(content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).is_error === true,
    )).toBe(true);
  });

  it("returns the valid action prefix and stores errors for the remaining tools", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const callClaude = fakeClaude(
      claudeResponse(
        memberTool("click-1", "left_click", { coordinate: [10, 20] }),
        customTool("bad-app", "open_app", { name: "Safari@" }),
        memberTool("click-2", "left_click", { coordinate: [20, 30] }),
      ),
      claudeResponse(customTool("finish-1", "finish", {
        success: true,
        summary: "Done.",
      })),
    );
    const actions = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
    });
    expect(actions).toMatchObject({
      kind: "actions",
      actions: [{ actionId: "click-1" }],
    });

    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId, {
        afterStep: 1,
        results: [{ actionId: "click-1", ok: true }],
      }),
      callClaude,
    });
    const userContent = getLastUserMessage(
      vi.mocked(callClaude).mock.calls[1]![0],
    )?.content as Array<Record<string, unknown>>;
    const results = userContent.filter(
      (block) => block.type === "tool_result",
    );

    expect(results).toMatchObject([
      { tool_use_id: "click-1", toolset_name: "computer", content: "OK" },
      {
        tool_use_id: "bad-app",
        is_error: true,
      },
      {
        tool_use_id: "click-2",
        toolset_name: "computer",
        is_error: true,
        content: "Not executed: an earlier computer action in this turn failed.",
      },
    ]);
  });

  it("turns missing action results into errors and halts later actions", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const callClaude = fakeClaude(
      claudeResponse(
        memberTool("missing-1", "left_click", { coordinate: [10, 20] }),
        customTool("missing-2", "open_app", { name: "Safari" }),
      ),
      claudeResponse(customTool("finish-1", "finish", {
        success: true,
        summary: "Done.",
      })),
    );
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
    });

    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId, { afterStep: 1 }),
      callClaude,
    });
    const userContent = getLastUserMessage(
      vi.mocked(callClaude).mock.calls[1]![0],
    )?.content as Array<Record<string, unknown>>;
    const results = userContent.filter(
      (block) => block.type === "tool_result",
    );

    expect(results).toMatchObject([
      {
        tool_use_id: "missing-1",
        toolset_name: "computer",
        is_error: true,
        content: "Not executed: no result was received for this action.",
      },
      {
        tool_use_id: "missing-2",
        is_error: true,
        content: "Not executed: an earlier computer action in this turn failed.",
      },
    ]);
  });

  it("rejects finish and ask_user when batched with another tool", async () => {
    for (const control of [
      customTool("finish-1", "finish", {
        success: true,
        summary: "Done.",
      }),
      customTool("ask-1", "ask_user", { question: "Proceed?" }),
    ]) {
      const store = new InMemoryTaskStore();
      const taskId = await createTask(store);
      const callClaude = fakeClaude(
        claudeResponse(
          control,
          memberTool("click-1", "left_click", { coordinate: [10, 20] }),
        ),
        claudeResponse(customTool("finish-2", "finish", {
          success: true,
          summary: "Done.",
        })),
      );
      await runAgentStep({
        store,
        deviceId,
        request: makeRequest(taskId),
        callClaude,
      });
      const retryBody = vi.mocked(callClaude).mock.calls[1]?.[0];
      const content = getLastUserMessage(retryBody!)?.content as Array<
        Record<string, unknown>
      >;
      expect(content).toMatchObject([
        {
          type: "tool_result",
          tool_use_id: control.id,
          is_error: true,
          content: `Call ${control.name} by itself in its own turn.`,
        },
        {
          type: "tool_result",
          tool_use_id: "click-1",
          toolset_name: "computer",
          is_error: true,
          content: "Call left_click by itself in its own turn.",
        },
      ]);
    }
  });

  it("waits for a user answer and includes it in the next tool result", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const notifier = makeNotifier();
    const waitingCall = fakeClaude(
      claudeResponse(
        customTool("ask-1", "ask_user", {
          question: "Should I open your personal account?",
        }),
      ),
    );
    const waiting = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude: waitingCall,
      notifier,
    });

    expect(waiting).toMatchObject({
      kind: "waiting",
      question: "Should I open your personal account?",
    });
    expect(notifier.sendQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ taskId }),
      "Should I open your personal account?",
      `question-${taskId}-2`,
    );
    expect(store.tasks.get(taskId)?.question).toBe(
      "Should I open your personal account?",
    );
    expect(JSON.stringify(store.tasks.get(taskId)?.agentMessages)).toContain(
      "Should I open your personal account?",
    );
    const whileWaiting = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId, { afterStep: 1 }),
      callClaude: waitingCall,
      notifier,
    });
    expect(whileWaiting).toEqual(waiting);
    expect(waitingCall).toHaveBeenCalledTimes(1);

    const answer = await store.routeInbound({
      providerMessageId: "answer-1",
      ownerId,
      deviceId,
      text: "Yes",
      replyProvider: "sendblue",
      replyHandle: "+15555550100",
      now: new Date(),
    });
    expect(answer.kind).toBe("answer");

    const nextCall = fakeClaude(
      claudeResponse(customTool("finish-2", "finish", {
        success: true,
        summary: "The personal account is open.",
      })),
    );
    const finished = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId, { afterStep: 1 }),
      callClaude: nextCall,
    });
    const body = vi.mocked(nextCall).mock.calls[0]?.[0];
    const result = (
      getLastUserMessage(body!)?.content as Array<Record<string, unknown>>
    ).find((block) => block.type === "tool_result");

    expect(finished).toMatchObject({ kind: "finished", state: "succeeded" });
    expect(result).toMatchObject({
      tool_use_id: "ask-1",
      content: 'The user replied: "Yes"',
    });
    expect(result).not.toHaveProperty("toolset_name");
    expect(await store.getUnconsumedInboundMessages(taskId)).toEqual([]);
  });

  it("adds each unconsumed correction and invalidates the prior step response", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const firstCall = fakeClaude(
      claudeResponse(
        memberTool("click-1", "left_click", { coordinate: [10, 20] }),
      ),
    );
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude: firstCall,
    });
    const correction = await store.routeInbound({
      providerMessageId: "correction-1",
      ownerId,
      deviceId,
      text: "Actually, open Safari instead.",
      replyProvider: "sendblue",
      replyHandle: "+15555550100",
      now: new Date(),
    });
    expect(correction.kind).toBe("correction");

    const nextCall = fakeClaude(
      claudeResponse(customTool("finish-1", "finish", {
        success: true,
        summary: "Safari is open.",
      })),
    );
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId, {
        afterStep: 1,
        results: [{ actionId: "click-1", ok: true }],
      }),
      callClaude: nextCall,
    });
    expect(flattenText(getLastUserMessage(
      vi.mocked(nextCall).mock.calls[0]![0],
    )?.content)).toContain(
      'The user sent a correction: "Actually, open Safari instead."',
    );
    expect(await store.getUnconsumedInboundMessages(taskId)).toEqual([]);
  });

  it("returns cancelled after Stop without calling Claude again", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const callClaude = fakeClaude(
      claudeResponse(
        memberTool("click-1", "left_click", { coordinate: [10, 20] }),
      ),
    );
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
    });
    await store.routeInbound({
      providerMessageId: "stop-1",
      ownerId,
      deviceId,
      text: " STOP. ",
      replyProvider: "sendblue",
      replyHandle: "+15555550100",
      now: new Date(),
    });
    const stopped = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId, { afterStep: 1 }),
      callClaude,
    });

    expect(stopped).toMatchObject({
      kind: "finished",
      state: "cancelled",
      summary: "Stopped.",
    });
    expect(callClaude).toHaveBeenCalledTimes(1);
  });

  it("expires stale tasks before routing the next inbound message", async () => {
    const store = new InMemoryTaskStore();
    const oldTime = new Date("2026-11-14T12:00:00.000Z");
    const first = await store.routeInbound({
      providerMessageId: "old-task",
      ownerId,
      deviceId,
      text: "Old task",
      replyProvider: "sendblue",
      replyHandle: "+15555550100",
      now: oldTime,
    });
    const next = await store.routeInbound({
      providerMessageId: "new-task",
      ownerId,
      deviceId,
      text: "New task",
      replyProvider: "sendblue",
      replyHandle: "+15555550100",
      now: new Date(oldTime.getTime() + 16 * 60 * 1000),
    });

    expect(next.kind).toBe("task");
    expect(next.taskId).not.toBe(first.taskId);
    expect(await store.getTask(first.taskId)).toMatchObject({
      state: "failed",
      summary: "Lost connection to your Mac.",
    });
  });

  it("fails at the 60-step cap and notifies the Sendblue thread once", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const task = store.tasks.get(taskId)!;
    task.state = "running";
    task.stepCount = MAX_AGENT_STEPS;
    const callClaude = fakeClaude();
    const notifier = makeNotifier();
    const result = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId, { afterStep: MAX_AGENT_STEPS }),
      callClaude,
      notifier,
      linkSecret: "cap-secret",
    });

    expect(result).toMatchObject({
      kind: "finished",
      state: "failed",
      summary: "This took too many steps.",
    });
    expect(callClaude).not.toHaveBeenCalled();
    expect(notifier.sendResult).toHaveBeenCalledTimes(1);
    expect(MAX_AGENT_STEPS).toBe(60);
    expect(vi.mocked(notifier.sendResult).mock.calls[0]?.[2]).toBe(
      `https://spectr-api.vercel.app/api/tasks/screenshot?task=${taskId}&sig=${createHmac("sha256", "cap-secret").update(taskId).digest("hex")}`,
    );
  });

  it("skips final result notifications for non-Sendblue tasks", async () => {
    const store = new InMemoryTaskStore();
    const routed = await store.routeInbound({
      providerMessageId: "chert-task",
      ownerId,
      deviceId,
      text: "Open Instagram",
      replyProvider: "chert",
      replyHandle: "+15555550100",
      now: new Date(),
    });
    const notifier = makeNotifier();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(routed.taskId),
      callClaude: fakeClaude(
        claudeResponse(customTool("finish-1", "finish", {
          success: true,
          summary: "The page is open.",
        })),
      ),
      notifier,
      linkSecret: "link-secret",
    });

    expect(notifier.sendResult).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Skipping result notification for provider chert",
    );
  });

  it("trims stored and sent conversations to the three newest images", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const task = store.tasks.get(taskId)!;
    task.state = "running";
    task.stepCount = 1;
    task.agentMessages = [
      {
        role: "user",
        content: [
          { type: "image", source: { data: "one" } },
          { type: "image", source: { data: "two" } },
          { type: "image", source: { data: "three" } },
          { type: "image", source: { data: "four" } },
          {
            type: "tool_result",
            tool_use_id: "screenshot-tool",
            content: [{ type: "image", source: { data: "nested" } }],
          },
        ],
      },
    ];
    const callClaude = fakeClaude(
      claudeResponse(customTool("finish-1", "finish", {
        success: true,
        summary: "Done.",
      })),
    );
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId, { afterStep: 1 }),
      callClaude,
    });
    const body = vi.mocked(callClaude).mock.calls[0]?.[0];
    const saved = store.tasks.get(taskId)?.agentMessages;

    expect(countImages(body?.messages)).toBe(3);
    expect(countImages(saved)).toBe(3);
    expect(flattenText(saved)).toContain("[older screenshot removed]");
  });

  it("enforces task ownership and leaves the step unchanged on Claude errors", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    await expect(
      runAgentStep({
        store,
        deviceId: "another-device",
        request: makeRequest(taskId),
        callClaude: fakeClaude(),
      }),
    ).rejects.toMatchObject({
      status: 404,
      body: { error: { code: "notFound" } },
    });

    const failingClaude: CallClaude = vi.fn(async () => {
      throw new Error("upstream unavailable");
    });
    await expect(
      runAgentStep({
        store,
        deviceId,
        request: makeRequest(taskId),
        callClaude: failingClaude,
      }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: { code: "upstreamError" } },
    });
    expect(store.tasks.get(taskId)?.stepCount).toBe(0);
    expect(store.tasks.get(taskId)?.state).toBe("accepted");
  });

  it("finishes the task for non-retryable Anthropic HTTP errors", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const notifier = makeNotifier();
    const message = `Invalid request ${"x".repeat(350)}`;
    const fetcher = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message },
          }),
          { status: 400 },
        ),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude: createAnthropicCaller("test-api-key", fetcher),
      notifier,
      linkSecret: "link-secret",
    });

    expect(result).toMatchObject({
      kind: "finished",
      state: "failed",
      summary: "Something went wrong on our end (error 400).",
    });
    expect(store.tasks.get(taskId)).toMatchObject({
      state: "failed",
      stepCount: 1,
      summary: "Something went wrong on our end (error 400).",
    });
    expect(notifier.sendResult).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "Anthropic request failed",
      400,
      "invalid_request_error",
      message.slice(0, 300),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-api-key");
  });

  it("keeps retryable Anthropic HTTP errors unpersisted", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const fetcher = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "overloaded_error",
              message: "Overloaded; try again later.",
            },
          }),
          { status: 529 },
        ),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      runAgentStep({
        store,
        deviceId,
        request: makeRequest(taskId),
        callClaude: createAnthropicCaller("test-api-key", fetcher),
      }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: { code: "upstreamError" } },
    });
    expect(store.tasks.get(taskId)).toMatchObject({
      state: "accepted",
      stepCount: 0,
    });
    expect(log).toHaveBeenCalledWith(
      "Anthropic request failed",
      529,
      "overloaded_error",
      "Overloaded; try again later.",
    );
  });

  it("returns the finished response when result notification fails", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const notifier = {
      ...makeNotifier(),
      sendResult: vi.fn(async () => {
        throw new Error("Sendblue unavailable");
      }),
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude: fakeClaude(
        claudeResponse(
          customTool("finish-1", "finish", {
            success: true,
            summary: "The page is open.",
          }),
        ),
      ),
      notifier,
      linkSecret: "link-secret",
    });

    expect(result).toMatchObject({
      kind: "finished",
      state: "succeeded",
      summary: "The page is open.",
    });
    expect(store.tasks.get(taskId)?.state).toBe("succeeded");
    expect(log).toHaveBeenCalledWith(
      "Result notification failed",
      "Sendblue unavailable",
    );
  });

  it("reports a signed final screenshot URL with a finished result", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const notifier = makeNotifier();
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude: fakeClaude(
        claudeResponse(customTool("finish-1", "finish", {
          success: true,
          summary: "Instagram is OPEN",
          attach_screenshot: true,
        })),
      ),
      notifier,
      linkSecret: "link-secret",
    });
    const expectedSignature = createHmac("sha256", "link-secret")
      .update(taskId)
      .digest("hex");
    const mediaUrl = vi.mocked(notifier.sendResult).mock.calls[0]?.[2];

    expect(mediaUrl).toBe(
      `https://spectr-api.vercel.app/api/tasks/screenshot?task=${taskId}&sig=${expectedSignature}`,
    );
    expect(vi.mocked(notifier.sendResult).mock.calls[0]?.[1]).toBe(
      "Done. Instagram is OPEN",
    );
  });

  it("omits the screenshot when a successful finish does not request one", async () => {
    const finishOptions: Array<{ attach_screenshot?: boolean }> = [
      { attach_screenshot: false },
      {},
    ];

    for (const options of finishOptions) {
      const store = new InMemoryTaskStore();
      const taskId = await createTask(store);
      const notifier = makeNotifier();
      await runAgentStep({
        store,
        deviceId,
        request: makeRequest(taskId),
        callClaude: fakeClaude(
          claudeResponse(
            customTool("finish-1", "finish", {
              success: true,
              summary: "The answer is 42.",
              ...options,
            }),
          ),
        ),
        notifier,
      });

      expect(vi.mocked(notifier.sendResult).mock.calls[0]?.[1]).toBe(
        "Done. The answer is 42.",
      );
      expect(vi.mocked(notifier.sendResult).mock.calls[0]?.[2]).toBeUndefined();
    }
  });

  it("attaches a screenshot when a task fails, even without the flag", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const notifier = makeNotifier();
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude: fakeClaude(
        claudeResponse(customTool("finish-1", "finish", {
          success: false,
          summary: "I could not complete the task.",
        })),
      ),
      notifier,
      linkSecret: "failure-secret",
    });

    const expectedSignature = createHmac("sha256", "failure-secret")
      .update(taskId)
      .digest("hex");
    expect(vi.mocked(notifier.sendResult).mock.calls[0]?.[2]).toBe(
      `https://spectr-api.vercel.app/api/tasks/screenshot?task=${taskId}&sig=${expectedSignature}`,
    );
  });

  it("texts summaries in full up to the 1200-character limit", async () => {
    expect(MAX_SUMMARY_CHARS).toBe(1200);
    for (const [summaryLength, expectedLength] of [
      [900, 900],
      [1500, MAX_SUMMARY_CHARS],
    ] as const) {
      const store = new InMemoryTaskStore();
      const taskId = await createTask(store);
      const notifier = makeNotifier();
      const summary = "x".repeat(summaryLength);
      const result = await runAgentStep({
        store,
        deviceId,
        request: makeRequest(taskId),
        callClaude: fakeClaude(
          claudeResponse(customTool("finish-1", "finish", {
            success: true,
            summary,
          })),
        ),
        notifier,
      });

      expect(result).toMatchObject({
        kind: "finished",
        summary: summary.slice(0, expectedLength),
      });
      expect(vi.mocked(notifier.sendResult).mock.calls[0]?.[1]).toBe(
        `Done. ${summary.slice(0, expectedLength)}`,
      );
    }
  });

  it("returns the stored finished response without a second Claude call or notification", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const notifier = makeNotifier();
    const callClaude = fakeClaude(
      claudeResponse(customTool("finish-1", "finish", {
        success: true,
        summary: "The page is open.",
      })),
    );
    const first = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
      notifier,
      linkSecret: "link-secret",
    });
    const replay = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
      notifier,
      linkSecret: "link-secret",
    });

    expect(replay).toEqual(first);
    expect(callClaude).toHaveBeenCalledTimes(1);
    expect(notifier.sendResult).toHaveBeenCalledTimes(1);
  });

  it("returns staleStep for a nonmatching afterStep", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude: fakeClaude(
        claudeResponse(
          memberTool("click-1", "left_click", { coordinate: [10, 20] }),
        ),
      ),
    });
    await expect(
      runAgentStep({
        store,
        deviceId,
        request: makeRequest(taskId, { afterStep: 9 }),
        callClaude: fakeClaude(),
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: { code: "staleStep" } },
    });
  });

  it("retries a turn with no tools once, then fails using the model text", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const callClaude = fakeClaude(
      claudeResponse({ type: "text", text: "I am still checking." }),
      claudeResponse({ type: "text", text: "I could not complete it." }),
    );
    const result = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
    });
    const retryBody = vi.mocked(callClaude).mock.calls[1]?.[0];

    expect(result).toMatchObject({
      kind: "finished",
      state: "failed",
      summary: "I could not complete it.",
    });
    expect(flattenText(getLastUserMessage(retryBody!)?.content)).toContain(
      "Call finish to report the result, or continue with actions.",
    );
  });

  it("makes no more than three Claude calls in one step", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    const callClaude = fakeClaude(
      claudeResponse(
        memberTool("invalid-1", "left_click", { coordinate: [100, 20] }),
      ),
      claudeResponse(
        memberTool("invalid-2", "left_click", { coordinate: [100, 20] }),
      ),
      claudeResponse(
        memberTool("invalid-3", "left_click", { coordinate: [100, 20] }),
      ),
    );
    const result = await runAgentStep({
      store,
      deviceId,
      request: makeRequest(taskId),
      callClaude,
    });

    expect(callClaude).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ kind: "finished", state: "failed" });
  });

  it("stops before a Claude call when the request deadline has less than 15 seconds left", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await createTask(store);
    let currentTime = 0;
    const clock = () => {
      const time = currentTime;
      currentTime += 100_000;
      return time;
    };
    const callClaude: CallClaude = vi.fn(async () =>
      claudeResponse(
        memberTool("invalid", "left_click", {
          coordinate: [100, 20],
        }),
      ),
    );

    await expect(
      runAgentStep({
        store,
        deviceId,
        request: makeRequest(taskId),
        callClaude,
        clock,
      }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: { code: "upstreamError" } },
    });

    expect(callClaude).toHaveBeenCalledTimes(2);
    expect(vi.mocked(callClaude).mock.calls[0]?.[1]).toEqual({
      timeoutMs: 90_000,
    });
    expect(vi.mocked(callClaude).mock.calls[1]?.[1]).toEqual({
      timeoutMs: 75_000,
    });
    expect(store.tasks.get(taskId)).toMatchObject({
      state: "accepted",
      stepCount: 0,
    });
  });
});
