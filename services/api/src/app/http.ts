// Shared response helpers for the iPhone app routes (`/api/app/*`). Errors use the same
// shape as the rest of the API so one decoder handles every route.

export type AppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "invalidRequest"
  | "noMac"
  | "phoneTaken"
  | "expired"
  | "misconfigured"
  | "upstreamError";

export function appError(status: number, code: AppErrorCode, message: string): Response {
  return Response.json(
    { error: { code, message, currentRevision: null } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function appJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function bearer(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/u)?.[1] ?? null;
}

export function missingEnv(env: Record<string, string | undefined>, names: string[]): Response | null {
  const missing = names.filter((name) => !env[name]);
  if (missing.length === 0) return null;
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  return appError(500, "misconfigured", `Missing environment variables: ${missing.join(", ")}`);
}
