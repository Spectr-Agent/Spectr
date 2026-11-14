import { createServer } from "node:http";
import postgres from "postgres";
import { GET as health } from "../api/health.js";
import type { CallClaude } from "../src/agent/anthropic.js";
import { createAnthropicCaller } from "../src/agent/anthropic.js";
import {
  createMacStepRoute,
  createMacTaskRoute,
  createTaskScreenshotRoute,
} from "../src/agent/routes.js";
import { createSendblueWebhookRoute } from "../src/sendblue/route.js";
import { createMacLiveKitRoute } from "../src/livekit/mac-token.js";
import { createAppApi } from "../src/app/routes.js";
import { createMacPairingRoutes } from "../src/app/mac-pairing.js";

const env = () => process.env;
const makeSql = (url: string) => postgres(url, { prepare: false, max: 1 });
const configuredCallLimit = process.env.MOCK_MAC_MAX_CLAUDE_CALLS;
const maxClaudeCalls = configuredCallLimit
  ? Number(configuredCallLimit)
  : 0;
if (
  configuredCallLimit &&
  (!Number.isInteger(maxClaudeCalls) || maxClaudeCalls < 1)
) {
  throw new Error("MOCK_MAC_MAX_CLAUDE_CALLS must be a positive integer.");
}
let claudeCallCount = 0;
const claudeCaller = process.env.ANTHROPIC_API_KEY
  ? createAnthropicCaller(process.env.ANTHROPIC_API_KEY)
  : undefined;
const callClaude: CallClaude | undefined =
  maxClaudeCalls > 0 && claudeCaller
    ? async (body, options) => {
        if (claudeCallCount >= maxClaudeCalls) {
          throw new Error("Local Claude call budget reached.");
        }
        claudeCallCount += 1;
        console.log(`Claude call ${claudeCallCount}/${maxClaudeCalls}`);
        return claudeCaller(body, options);
      }
    : undefined;
const app = createAppApi(env, makeSql);
const macPairing = createMacPairingRoutes(env, makeSql);
const routes = new Map<string, (request: Request) => Promise<Response>>([
  ["POST /api/sendblue/webhook", createSendblueWebhookRoute(env, makeSql)],
  ["GET /api/mac/task", createMacTaskRoute(env, makeSql)],
  ["GET /api/mac/livekit", createMacLiveKitRoute(env, makeSql)],
  [
    "POST /api/mac/step",
    createMacStepRoute(
      env,
      makeSql,
      callClaude ? { callClaude } : undefined,
    ),
  ],
  ["GET /api/tasks/screenshot", createTaskScreenshotRoute(env, makeSql)],
  ["GET /api/app/home", app.home],
  ["GET /api/app/task", app.task],
  ["POST /api/app/message", app.message],
  ["POST /api/app/stop", app.stop],
  ["POST /api/app/live", app.live],
  ["POST /api/app/pair", app.pair],
  ["POST /api/app/phone", app.phone],
  ["DELETE /api/app/phone", app.phone],
  ["POST /api/mac/pair", macPairing.start],
  ["POST /api/mac/pair-status", macPairing.status],
]);

async function requestFromNode(
  request: import("node:http").IncomingMessage,
): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  const method = request.method ?? "GET";
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "127.0.0.1"}`,
  );
  const body = Buffer.concat(chunks);
  return new Request(url, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" || body.length === 0
      ? {}
      : { body: body as unknown as BodyInit }),
  });
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = await requestFromNode(incoming);
    const url = new URL(request.url);
    let response: Response;
    if (
      request.method === "POST" &&
      url.pathname === "/fake-sendblue/api/send-message"
    ) {
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        payload = {};
      }
      const message =
        typeof payload === "object" && payload !== null
          ? payload as Record<string, unknown>
          : {};
      console.log(
        "fake Sendblue",
        JSON.stringify({
          destination: message.number,
          content: message.content,
          media: message.media_url ?? null,
        }),
      );
      response = Response.json({ status: "QUEUED" });
    } else if (
      request.method === "GET" &&
      ["/health", "/api/health"].includes(url.pathname)
    ) {
      response = health();
    } else {
      const handler = routes.get(`${request.method} ${url.pathname}`);
      response = handler
        ? await handler(request)
        : Response.json({ error: "notFound" }, { status: 404 });
    }
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(
      "dev server request failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ error: "internalError" }));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, "127.0.0.1", () => {
  console.log(`dev server listening on http://127.0.0.1:${port}`);
});
