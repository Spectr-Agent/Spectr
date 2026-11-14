import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
  type AnthropicRequest,
  type CallClaude,
} from "../src/agent/anthropic.js";
import { createMacStepRoute, createMacTaskRoute, createTaskScreenshotRoute } from "../src/agent/routes.js";
import type { MacAction } from "../src/contracts.js";
import { InMemoryTaskStore } from "../src/memory-store.js";
import {
  calculateScreenshotDimensions,
  fixtureExecutor,
  mapKeyComboToXdotool,
  scaleCoordinate,
  type MockMacExecutor,
} from "../src/mock-mac/executors.js";
import { runMockMac } from "../src/mock-mac/loop.js";
import { createSendblueWebhookRoute } from "../src/sendblue/route.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ownerId = "owner_mock_mac";
const deviceId = "dev_mock_mac";
const token = "mock-device-token";
const phone = "+14704249734";
const webhookSecret = "mock-webhook-secret";

let screenshotDirectory: string;
let screenshotPath: string;
let screenshotBytes: Buffer;

beforeAll(async () => {
  screenshotDirectory = await mkdtemp(join(tmpdir(), "spectr-mock-mac-test-"));
  screenshotPath = join(screenshotDirectory, "screenshot.png");
  screenshotBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64",
  );
  await writeFile(screenshotPath, screenshotBytes);
});

afterAll(async () => {
  if (screenshotDirectory) {
    await rm(screenshotDirectory, { recursive: true, force: true });
  }
});

interface OutboundMessage {
  destination: string;
  content: string;
  mediaUrl?: string;
}

interface Harness {
  store: InMemoryTaskStore;
  dispatch: typeof fetch;
  sendText(text: string): Promise<{ taskId: string }>;
  callClaude: CallClaude;
  calls: AnthropicRequest[];
  outbound: OutboundMessage[];
}

function fakeClaude(responses: unknown[][]): {
  callClaude: CallClaude;
  calls: AnthropicRequest[];
} {
  const queue = [...responses];
  const calls: AnthropicRequest[] = [];
  const callClaude: CallClaude = async (body) => {
    calls.push(body);
    const content = queue.shift();
    if (!content) {
      throw new Error("Unexpected Claude call");
    }
    return { content };
  };
  return { callClaude, calls };
}

function tool(
  id: string,
  name: string,
  input: unknown,
  toolsetName?: "computer",
): unknown {
  return {
    type: "tool_use",
    id,
    name,
    input,
    ...(toolsetName ? { toolset_name: toolsetName } : {}),
  };
}

async function makeHarness(responses: unknown[][]): Promise<Harness> {
  const store = new InMemoryTaskStore();
  store.deviceTokenHashes.set(
    createHash("sha256").update(token).digest("hex"),
    deviceId,
  );
  const { callClaude, calls } = fakeClaude(responses);
  const outbound: OutboundMessage[] = [];
  const sendblueFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url !== "https://fake-sendblue.test/api/send-message") {
      throw new Error(`Unexpected external request: ${url}`);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    outbound.push({
      destination: String(body.number),
      content: String(body.content),
      ...(typeof body.media_url === "string"
        ? { mediaUrl: body.media_url }
        : {}),
    });
    return Response.json({ status: "QUEUED" });
  };
  const query = async () => [{ owner_id: ownerId, device_id: deviceId }];
  const sql = Object.assign(query, {
    json: (value: unknown) => value,
  }) as unknown as postgres.Sql;
  const makeSql = () => sql;
  const environment = {
    POSTGRES_URL: "postgres://mock:mock@localhost/mock",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    SENDBLUE_API_KEY_ID: "test-sendblue-id",
    SENDBLUE_API_SECRET_KEY: "test-sendblue-secret",
    SENDBLUE_FROM_NUMBER: "+15555550123",
    SENDBLUE_WEBHOOK_SECRET: webhookSecret,
    SENDBLUE_API_BASE_URL: "https://fake-sendblue.test",
    SPECTR_LINK_SECRET: "mock-link-secret",
    SPECTR_PUBLIC_URL: "http://localhost:3000",
  };
  const storeOverride = { makeStore: () => store };
  const handlers = new Map<string, (request: Request) => Promise<Response>>([
    [
      "POST /api/sendblue/webhook",
      createSendblueWebhookRoute(
        () => environment,
        makeSql,
        { ...storeOverride, fetch: sendblueFetch },
      ),
    ],
    [
      "GET /api/mac/task",
      createMacTaskRoute(() => environment, makeSql, storeOverride),
    ],
    [
      "POST /api/mac/step",
      createMacStepRoute(() => environment, makeSql, {
        ...storeOverride,
        callClaude,
        fetch: sendblueFetch,
      }),
    ],
    [
      "GET /api/tasks/screenshot",
      createTaskScreenshotRoute(() => environment, makeSql, storeOverride),
    ],
  ]);
  const dispatch: typeof fetch = async (input, init) => {
    const request =
      input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const handler = handlers.get(`${request.method} ${url.pathname}`);
    return handler
      ? handler(request)
      : Response.json({ error: "notFound" }, { status: 404 });
  };
  const sendText = async (text: string) => {
    const response = await dispatch(
      new Request("http://localhost:3000/api/sendblue/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sb-signing-secret": webhookSecret,
        },
        body: JSON.stringify({
          message_handle: randomUUID(),
          from_number: phone,
          content: text,
          is_outbound: false,
          status: "RECEIVED",
          group_id: "",
          date_sent: new Date().toISOString(),
          media_url: "",
        }),
      }),
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{ taskId: string }>;
  };

  return { store, dispatch, sendText, callClaude, calls, outbound };
}

function textIn(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(textIn).join("\n");
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).map(textIn).join("\n");
  }
  return "";
}

function createFixture(): MockMacExecutor & { actions: MacAction[] } {
  return fixtureExecutor({ screenshotPath });
}

describe("mock Mac end-to-end loop", () => {
  it("opens Instagram, takes a screenshot, finishes, notifies, and serves the signed image", async () => {
    const harness = await makeHarness([
      [tool("open-1", "open_url", { url: "instagram.com" })],
      [tool("screen-1", "screenshot", {}, "computer")],
      [
        tool("finish-1", "finish", {
          success: true,
          summary: "Instagram is open.",
        }),
      ],
    ]);
    const executor = createFixture();
    const { taskId } = await harness.sendText(
      "open instagram.com in the browser",
    );
    const finished = await runMockMac({
      apiUrl: "http://localhost:3000",
      token,
      executor,
      fetch: harness.dispatch,
      sleep: async () => {},
      once: true,
      log: () => {},
    });

    expect(finished).toMatchObject({
      kind: "finished",
      taskId,
      state: "succeeded",
      summary: "Instagram is open.",
    });
    expect(executor.actions.map((action) => action.type)).toEqual([
      "openUrl",
      "screenshot",
    ]);
    expect(harness.outbound.some((message) => message.mediaUrl)).toBe(true);
    expect(
      harness.outbound.find((message) => message.mediaUrl)?.content,
    ).toContain("done. instagram is open.");
    const mediaUrl = harness.outbound.find((message) => message.mediaUrl)
      ?.mediaUrl;
    expect(mediaUrl).toBeTruthy();
    const screenshot = await harness.dispatch(new Request(mediaUrl!));
    expect(screenshot.status).toBe(200);
    expect(screenshot.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await screenshot.arrayBuffer())).toEqual(screenshotBytes);
  });

  it("waits for a yes answer and resumes the stored conversation", async () => {
    const harness = await makeHarness([
      [tool("ask-1", "ask_user", { question: "Should I open the account?" })],
      [
        tool("finish-1", "finish", {
          success: true,
          summary: "The account is open.",
        }),
      ],
    ]);
    const { taskId } = await harness.sendText("open my account");
    let answerSent = false;
    const finished = await runMockMac({
      apiUrl: "http://localhost:3000",
      token,
      executor: createFixture(),
      fetch: harness.dispatch,
      sleep: async (milliseconds) => {
        if (milliseconds === 3000 && !answerSent) {
          answerSent = true;
          await harness.sendText("yes");
        }
      },
      once: true,
      log: () => {},
    });

    expect(finished).toMatchObject({
      kind: "finished",
      taskId,
      state: "succeeded",
    });
    expect(harness.calls).toHaveLength(2);
    expect(textIn(harness.calls[1]?.messages)).toContain(
      'The user replied: "yes"',
    );
  });

  it("honors Stop between steps without another Claude call or a Done result", async () => {
    const harness = await makeHarness([
      [tool("open-1", "open_url", { url: "instagram.com" })],
    ]);
    const { taskId } = await harness.sendText("open Instagram");
    const fixture = createFixture();
    const executor: MockMacExecutor = {
      screenshot: () => fixture.screenshot(),
      async execute(action) {
        const result = await fixture.execute(action);
        if (action.type === "openUrl") {
          await harness.sendText("Stop");
        }
        return result;
      },
    };
    const finished = await runMockMac({
      apiUrl: "http://localhost:3000",
      token,
      executor,
      fetch: harness.dispatch,
      sleep: async () => {},
      once: true,
      log: () => {},
    });

    expect(finished).toMatchObject({
      kind: "finished",
      taskId,
      state: "cancelled",
    });
    expect(harness.calls).toHaveLength(1);
    expect(harness.outbound.map((message) => message.content).join("\n"))
      .not.toContain("Done");
  });

  it("reports a failed action and does not execute later actions in the batch", async () => {
    const harness = await makeHarness([
      [
        tool("open-1", "open_url", { url: "instagram.com" }),
        tool("click-1", "left_click", { coordinate: [0, 0] }, "computer"),
      ],
      [
        tool("finish-1", "finish", {
          success: false,
          summary: "The browser action failed.",
        }),
      ],
    ]);
    const { taskId } = await harness.sendText("open Instagram");
    const fixture = createFixture();
    const executor: MockMacExecutor = {
      screenshot: () => fixture.screenshot(),
      async execute(action) {
        const result = await fixture.execute(action);
        return action.type === "openUrl"
          ? { ok: false, error: "fixture action failed" }
          : result;
      },
    };
    const finished = await runMockMac({
      apiUrl: "http://localhost:3000",
      token,
      executor,
      fetch: harness.dispatch,
      sleep: async () => {},
      once: true,
      log: () => {},
    });

    expect(finished).toMatchObject({
      kind: "finished",
      taskId,
      state: "failed",
    });
    expect(fixture.actions.map((action) => action.type)).toEqual(["openUrl"]);
    expect(textIn(harness.calls[1]?.messages)).toContain(
      "Not executed: an earlier computer action in this turn failed.",
    );
  });

  it("forwards a correction received between steps to Claude", async () => {
    const harness = await makeHarness([
      [tool("open-1", "open_url", { url: "instagram.com" })],
      [tool("open-2", "open_url", { url: "wikipedia.org" })],
      [
        tool("finish-1", "finish", {
          success: true,
          summary: "Wikipedia is open.",
        }),
      ],
    ]);
    const { taskId } = await harness.sendText("open Instagram");
    const fixture = createFixture();
    const executor: MockMacExecutor = {
      screenshot: () => fixture.screenshot(),
      async execute(action) {
        const result = await fixture.execute(action);
        if (action.type === "openUrl" && fixture.actions.length === 1) {
          await harness.sendText("Actually, open wikipedia.org instead.");
        }
        return result;
      },
    };
    const finished = await runMockMac({
      apiUrl: "http://localhost:3000",
      token,
      executor,
      fetch: harness.dispatch,
      sleep: async () => {},
      once: true,
      log: () => {},
    });

    expect(finished).toMatchObject({
      kind: "finished",
      taskId,
      state: "succeeded",
    });
    expect(fixture.actions.map((action) => action.type)).toEqual([
      "openUrl",
      "openUrl",
    ]);
    expect(textIn(harness.calls[1]?.messages)).toContain(
      "Actually, open wikipedia.org instead.",
    );
  });
});

describe("desktop executor mapping", () => {
  it("maps key combinations to xdotool argv without running xdotool", () => {
    expect(mapKeyComboToXdotool("cmd+shift+a", 2)).toEqual([
      "key",
      "--repeat",
      "2",
      "ctrl+shift+a",
    ]);
    expect(mapKeyComboToXdotool("option+return")).toEqual([
      "key",
      "--repeat",
      "1",
      "alt+Return",
    ]);
    expect(mapKeyComboToXdotool("+")).toEqual([
      "key",
      "--repeat",
      "1",
      "plus",
    ]);
  });

  it("resizes screenshots within limits and maps image coordinates back to the desktop", () => {
    const resized = calculateScreenshotDimensions(3840, 2160);
    expect(resized).toEqual({ width: 1280, height: 720 });
    expect(Math.max(resized.width, resized.height)).toBeLessThanOrEqual(1280);
    expect(
      Math.ceil(resized.width / 28) * Math.ceil(resized.height / 28),
    ).toBeLessThanOrEqual(4784);
    expect(scaleCoordinate(640, 3840, resized.width)).toBe(1920);
    expect(scaleCoordinate(720, 2160, resized.height)).toBe(2160 - 1);
  });
});
