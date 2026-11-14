import { MAX_BODY_BYTES, RATE_LIMIT, createRateLimiter, normalizeEmail, saveSignup } from "@/lib/waitlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter(RATE_LIMIT);
const reply = (body: { ok: boolean; error?: string }, status = 200, headers?: Record<string, string>) => Response.json(body, { status, headers });

function clientAddress(request: Request): string {
  // On Vercel the platform sets these, so the first address is the visitor's.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ ok: false, error: "forbidden" }, 403);

  const limit = limiter.check(clientAddress(request));
  if (!limit.allowed) return reply({ ok: false, error: "rate_limited" }, 429, { "retry-after": String(limit.retryAfterSeconds) });

  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return reply({ ok: false, error: "too_large" }, 413);

  let body: { email?: unknown; company?: unknown } = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) body = parsed;
  } catch {
    return reply({ ok: false, error: "invalid_email" }, 400);
  }

  // Honeypot: a person never fills this in. Say yes and store nothing.
  if (typeof body.company === "string" && body.company.trim() !== "") return reply({ ok: true });

  const email = normalizeEmail(body.email);
  if (!email) return reply({ ok: false, error: "invalid_email" }, 400);

  try {
    await saveSignup(email);
  } catch (error) {
    console.error("waitlist save failed:", error instanceof Error ? error.message : "unknown error");
    return reply({ ok: false, error: "server_error" }, 500);
  }
  return reply({ ok: true });
}
