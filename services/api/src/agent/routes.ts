import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import postgres from "postgres";
import {
  ApiErrorSchema,
  MacStepRequestSchema,
  MacTaskResponseSchema,
} from "../contracts.js";
import { PostgresTaskStore } from "../pg-store.js";
import { createChertReplier } from "../chert/client.js";
import { createSendblueReplier } from "../sendblue/client.js";
import { createAnthropicCaller } from "./anthropic.js";
import { apiErrorResponse } from "./errors.js";
import { runAgentStep, type StepNotifier } from "./step.js";
import type { AgentTaskRecord } from "./types.js";

type RouteEnvironment = Record<string, string | undefined>;
type MakeSql = (url: string) => postgres.Sql;
type Replier = (
  toNumber: string,
  text: string,
  idempotencyKey: string,
  mediaUrl?: string,
) => Promise<void>;

function configurationError(missing: readonly string[]): Response {
  console.error(missing.join(", "));
  return Response.json(
    ApiErrorSchema.parse({
      error: {
        code: "misconfigured",
        message: `Missing environment variables: ${missing.join(", ")}`,
        currentRevision: null,
      },
    }),
    { status: 500 },
  );
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/u);
  return match?.[1] ?? null;
}

function unauthorized(): Response {
  return Response.json(
    ApiErrorSchema.parse({
      error: {
        code: "forbidden",
        message: "A valid Mac device token is required.",
        currentRevision: null,
      },
    }),
    { status: 401 },
  );
}

function screenshotNotFound(): Response {
  return Response.json(
    ApiErrorSchema.parse({
      error: {
        code: "notFound",
        message: "Screenshot not found.",
        currentRevision: null,
      },
    }),
    { status: 404 },
  );
}

function makeDefaultSql(url: string): postgres.Sql {
  return postgres(url, { prepare: false, max: 1 });
}

function notifier(env: RouteEnvironment): StepNotifier {
  const sendblue: Replier | undefined =
    env.SENDBLUE_API_KEY_ID &&
    env.SENDBLUE_API_SECRET_KEY &&
    env.SENDBLUE_FROM_NUMBER
      ? createSendblueReplier({
          apiKeyId: env.SENDBLUE_API_KEY_ID,
          apiSecretKey: env.SENDBLUE_API_SECRET_KEY,
          fromNumber: env.SENDBLUE_FROM_NUMBER,
        })
      : undefined;
  const chert: Replier | undefined =
    env.CHERT_API_KEY && env.CHERT_PROJECT_ID && env.CHERT_LINE_ID
      ? createChertReplier({
          apiKey: env.CHERT_API_KEY,
          projectId: env.CHERT_PROJECT_ID,
          lineId: env.CHERT_LINE_ID,
        })
      : undefined;

  return {
    async sendQuestion(
      task: AgentTaskRecord,
      question: string,
      idempotencyKey: string,
    ) {
      if (!task.replyHandle) {
        return;
      }
      const replier =
        task.replyProvider === "chert"
          ? chert
          : task.replyProvider === "sendblue"
            ? sendblue
            : undefined;
      if (!replier) {
        console.info(
          `Skipping question notification for provider ${task.replyProvider ?? "unknown"}`,
        );
        return;
      }
      await replier(task.replyHandle, question, idempotencyKey);
    },
    async sendResult(
      task: AgentTaskRecord,
      text: string,
      mediaUrl: string,
      idempotencyKey: string,
    ) {
      if (
        task.replyProvider !== "sendblue" ||
        !task.replyHandle ||
        !sendblue
      ) {
        console.info(
          `Skipping result notification for provider ${task.replyProvider ?? "unknown"}`,
        );
        return;
      }
      await sendblue(task.replyHandle, text, idempotencyKey, mediaUrl);
    },
  };
}

export function createMacTaskRoute(
  getEnv: () => RouteEnvironment,
  makeSql: MakeSql = makeDefaultSql,
): (request: Request) => Promise<Response> {
  let sql: postgres.Sql | undefined;
  return async (request) => {
    try {
      const env = getEnv();
      const missing = ["POSTGRES_URL"].filter((name) => !env[name]);
      if (missing.length > 0) {
        return configurationError(missing);
      }
      const token = bearerToken(request);
      if (!token) {
        return unauthorized();
      }
      const connection = (sql ??= makeSql(env.POSTGRES_URL!));
      const store = new PostgresTaskStore(connection);
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const deviceId = await store.authenticateDevice(tokenHash);
      if (!deviceId) {
        return unauthorized();
      }
      const task = await store.getActiveTaskForDevice(deviceId, new Date());
      return Response.json(
        MacTaskResponseSchema.parse({
          task: task
            ? {
                taskId: task.taskId,
                revision: task.revision,
                state: task.state,
                instruction: task.instruction,
                step: task.stepCount,
              }
            : null,
        }),
      );
    } catch (error) {
      return apiErrorResponse(error);
    }
  };
}

export function createMacStepRoute(
  getEnv: () => RouteEnvironment,
  makeSql: MakeSql = makeDefaultSql,
): (request: Request) => Promise<Response> {
  let sql: postgres.Sql | undefined;
  return async (request) => {
    try {
      const env = getEnv();
      const required = [
        "POSTGRES_URL",
        "ANTHROPIC_API_KEY",
        "SPECTR_LINK_SECRET",
        "SENDBLUE_API_KEY_ID",
        "SENDBLUE_API_SECRET_KEY",
        "SENDBLUE_FROM_NUMBER",
      ] as const;
      const missing = required.filter((name) => !env[name]);
      if (missing.length > 0) {
        return configurationError(missing);
      }
      const token = bearerToken(request);
      if (!token) {
        return unauthorized();
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          ApiErrorSchema.parse({
            error: {
              code: "invalidRequest",
              message: "Request body must be valid JSON.",
              currentRevision: null,
            },
          }),
          { status: 400 },
        );
      }
      const parsed = MacStepRequestSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json(
          ApiErrorSchema.parse({
            error: {
              code: "invalidRequest",
              message: parsed.error.issues[0]?.message ?? "Invalid request.",
              currentRevision: null,
            },
          }),
          { status: 400 },
        );
      }
      const connection = (sql ??= makeSql(env.POSTGRES_URL!));
      const store = new PostgresTaskStore(connection);
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const deviceId = await store.authenticateDevice(tokenHash);
      if (!deviceId) {
        return unauthorized();
      }
      const response = await runAgentStep({
        store,
        deviceId,
        request: parsed.data,
        callClaude: createAnthropicCaller(env.ANTHROPIC_API_KEY!),
        notifier: notifier(env),
        model: env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
        linkSecret: env.SPECTR_LINK_SECRET,
        publicUrl: env.SPECTR_PUBLIC_URL,
      });
      return Response.json(response);
    } catch (error) {
      return apiErrorResponse(error);
    }
  };
}

export function createTaskScreenshotRoute(
  getEnv: () => RouteEnvironment,
  makeSql: MakeSql = makeDefaultSql,
): (request: Request) => Promise<Response> {
  let sql: postgres.Sql | undefined;
  return async (request) => {
    try {
      const env = getEnv();
      const missing = ["POSTGRES_URL", "SPECTR_LINK_SECRET"].filter(
        (name) => !env[name],
      );
      if (missing.length > 0) {
        return configurationError(missing);
      }
      const url = new URL(request.url);
      const taskId = url.searchParams.get("task");
      const signature = url.searchParams.get("sig");
      if (
        !taskId ||
        !signature ||
        !/^[a-f\d]{64}$/iu.test(signature)
      ) {
        return screenshotNotFound();
      }
      const expected = createHmac("sha256", env.SPECTR_LINK_SECRET!)
        .update(taskId)
        .digest();
      const supplied = Buffer.from(signature, "hex");
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        return screenshotNotFound();
      }
      const connection = (sql ??= makeSql(env.POSTGRES_URL!));
      const task = await new PostgresTaskStore(connection).getTask(taskId);
      if (!task?.finalScreenshot || !task.finalScreenshotType) {
        return screenshotNotFound();
      }
      return new Response(Buffer.from(task.finalScreenshot), {
        headers: {
          "content-type": task.finalScreenshotType,
          "cache-control": "private, no-store",
        },
      });
    } catch (error) {
      return apiErrorResponse(error);
    }
  };
}
