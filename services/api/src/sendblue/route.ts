import postgres from "postgres";
import { createSenderResolver, PostgresTaskStore } from "../pg-store.js";
import { createSendblueReplier } from "./client.js";
import { handleSendblueWebhook } from "./webhook.js";
import type { RouteOverrides } from "../route-deps.js";

type RouteEnvironment = Record<string, string | undefined>;

const requiredEnvironmentNames = [
  "SENDBLUE_API_KEY_ID",
  "SENDBLUE_API_SECRET_KEY",
  "SENDBLUE_FROM_NUMBER",
  "SENDBLUE_WEBHOOK_SECRET",
  "POSTGRES_URL",
] as const;

export function createSendblueWebhookRoute(
  getEnv: () => RouteEnvironment,
  makeSql: (url: string) => postgres.Sql = (url) =>
    postgres(url, { prepare: false, max: 1 }),
  overrides?: RouteOverrides,
): (request: Request) => Promise<Response> {
  let sql: postgres.Sql | undefined;

  return async (request) => {
    const env = getEnv();
    const missing = requiredEnvironmentNames.filter((name) => !env[name]);
    if (missing.length > 0) {
      console.error(missing.join(", "));
      return Response.json(
        { ok: false, error: "misconfigured" },
        { status: 500 },
      );
    }

    const apiKeyId = env.SENDBLUE_API_KEY_ID!;
    const apiSecretKey = env.SENDBLUE_API_SECRET_KEY!;
    const fromNumber = env.SENDBLUE_FROM_NUMBER!;
    const secret = env.SENDBLUE_WEBHOOK_SECRET!;
    const postgresUrl = env.POSTGRES_URL!;

    try {
      const rawBody = await request.text();
      const headers = Object.fromEntries(request.headers.entries());
      const connection = (sql ??= makeSql(postgresUrl));
      const result = await handleSendblueWebhook(
        { rawBody, headers },
        {
          secret,
          inbound: {
            store:
              overrides?.makeStore?.(connection) ??
              new PostgresTaskStore(connection),
            provider: "sendblue",
            resolveSender: createSenderResolver(connection, "sendblue"),
            sendReply: createSendblueReplier({
              apiKeyId,
              apiSecretKey,
              fromNumber,
              baseUrl: env.SENDBLUE_API_BASE_URL,
              fetch: overrides?.fetch,
            }),
          },
        },
      );
      if (result.status === 401) {
        console.warn(Object.keys(headers).join(", "));
      }
      return Response.json(result.body, { status: result.status });
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unknown error");
      return Response.json(
        { ok: false, error: "internalError" },
        { status: 500 },
      );
    }
  };
}
