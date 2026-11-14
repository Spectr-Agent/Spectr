// Pairing from the Mac's side. The Mac has no account, so it asks for a short code, shows
// it, and polls with a secret only it holds. When the signed-in iPhone enters the code
// (`POST /api/app/pair`), the next poll hands the Mac its device token exactly once.
//
//   POST /api/mac/pair          { name }                    -> { pairingId, code, pollSecret, expiresAt }
//   POST /api/mac/pair-status   { pairingId, pollSecret }   -> pending | paired (with token, once) | expired
//
// Owner: Jared.

import postgres from "postgres";
import { z } from "zod";
import { appError, appJson, missingEnv, readJson } from "./http.js";
import { PostgresAppStore, type AppStore } from "./store.js";

type RouteEnvironment = Record<string, string | undefined>;
type MakeSql = (url: string) => postgres.Sql;

const StartSchema = z.object({ name: z.string().trim().min(1).max(80) });
const StatusSchema = z.object({
  pairingId: z.string().regex(/^pair_[0-9a-f-]{36}$/u),
  pollSecret: z.string().min(20).max(100),
});

export function createMacPairingRoutes(
  getEnv: () => RouteEnvironment,
  makeSql: MakeSql = (url) => postgres(url, { prepare: false, max: 1 }),
  overrides: { makeAppStore?: (sql: postgres.Sql, sealSecret: string) => AppStore; now?: () => Date } = {},
) {
  let sql: postgres.Sql | undefined;
  const store = (env: RouteEnvironment) => {
    const connection = (sql ??= makeSql(env.POSTGRES_URL!));
    return overrides.makeAppStore?.(connection, env.SPECTR_LINK_SECRET!) ?? new PostgresAppStore(connection, env.SPECTR_LINK_SECRET!);
  };
  const now = () => overrides.now?.() ?? new Date();

  const start = async (request: Request): Promise<Response> => {
    const env = getEnv();
    const misconfigured = missingEnv(env, ["POSTGRES_URL", "SPECTR_LINK_SECRET"]);
    if (misconfigured) return misconfigured;
    const parsed = StartSchema.safeParse(await readJson(request));
    if (!parsed.success) return appError(400, "invalidRequest", "The Mac's name is required.");
    try {
      return appJson(await store(env).startPairing(parsed.data.name, now()));
    } catch (error) {
      console.error("pairing start failed", error);
      return appError(500, "upstreamError", "Couldn't start pairing. Try again.");
    }
  };

  const status = async (request: Request): Promise<Response> => {
    const env = getEnv();
    const misconfigured = missingEnv(env, ["POSTGRES_URL", "SPECTR_LINK_SECRET"]);
    if (misconfigured) return misconfigured;
    const parsed = StatusSchema.safeParse(await readJson(request));
    if (!parsed.success) return appError(400, "invalidRequest", "Unknown pairing.");
    try {
      const result = await store(env).pollPairing(parsed.data.pairingId, parsed.data.pollSecret, now());
      if (result.status === "expired") return appError(410, "expired", "This code expired. Get a new one.");
      return appJson(result);
    } catch (error) {
      console.error("pairing status failed", error);
      return appError(500, "upstreamError", "Couldn't check pairing. Try again.");
    }
  };

  return { start, status };
}

/** Both pairing routes in one function; vercel.json rewrites `/api/mac/pair-status` here. */
export function createMacPairingDispatcher(getEnv: () => RouteEnvironment, makeSql?: MakeSql) {
  const routes = createMacPairingRoutes(getEnv, makeSql);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const status = url.searchParams.has("status") || url.pathname.endsWith("/pair-status");
    return status ? routes.status(request) : routes.start(request);
  };
}
