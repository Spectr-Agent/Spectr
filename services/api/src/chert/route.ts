import postgres from "postgres";
import { createChertReplier } from "./client.js";
import { handleChertWebhook } from "./webhook.js";
import { createSenderResolver, PostgresTaskStore } from "../pg-store.js";

type RouteEnvironment = Record<string, string | undefined>;

const requiredEnvironmentNames = [
  "CHERT_WEBHOOK_SECRET",
  "CHERT_API_KEY",
  "CHERT_PROJECT_ID",
  "CHERT_LINE_ID",
  "POSTGRES_URL",
] as const;

export function createChertWebhookRoute(
  getEnv: () => RouteEnvironment,
  makeSql: (url: string) => postgres.Sql = (url) =>
    postgres(url, { prepare: false, max: 1 }),
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

    const webhookSecret = env.CHERT_WEBHOOK_SECRET!;
    const apiKey = env.CHERT_API_KEY!;
    const projectId = env.CHERT_PROJECT_ID!;
    const lineId = env.CHERT_LINE_ID!;
    const postgresUrl = env.POSTGRES_URL!;

    try {
      const rawBody = await request.text();
      const headers = Object.fromEntries(request.headers.entries());
      const connection = (sql ??= makeSql(postgresUrl));
      const result = await handleChertWebhook(
        { rawBody, headers },
        {
          secret: webhookSecret,
          inbound: {
            store: new PostgresTaskStore(connection),
            provider: "chert",
            resolveSender: createSenderResolver(connection, "chert"),
            sendReply: createChertReplier({
              apiKey,
              projectId,
              lineId,
            }),
          },
        },
      );
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
