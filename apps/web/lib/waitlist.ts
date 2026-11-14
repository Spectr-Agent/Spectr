// Waitlist logic for POST /api/waitlist. Server only: nothing here may reach the browser.

export const MAX_BODY_BYTES = 2048;
export const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };

/** Returns the cleaned address, or null if it doesn't look like an email. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

export interface RateLimiter {
  check(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number };
}

/**
 * A sliding window limiter kept in memory. On serverless hosting each instance
 * has its own counter, so this slows down casual abuse and nothing more.
 */
export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [name, times] of hits) if (times.every((time) => now - time >= windowMs)) hits.delete(name);
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

export interface StoreConfig {
  url?: string;
  key?: string;
  fetcher?: typeof fetch;
}

export function readStoreConfig(env: Record<string, string | undefined> = process.env): StoreConfig {
  return { url: env.SUPABASE_URL, key: env.SUPABASE_SECRET_KEY };
}

/**
 * Saves one signup. With Supabase configured it inserts into public.waitlist
 * through the server only secret key (a repeated email is ignored). Without it,
 * the address is logged to the server console and nothing is stored, which is
 * the stopgap until the waitlist table is approved. See docs/web.md.
 */
export async function saveSignup(email: string, config: StoreConfig = readStoreConfig()): Promise<"stored" | "logged"> {
  const { url, key, fetcher = fetch } = config;
  if (!url || !key) {
    console.info("waitlist signup (not stored, Supabase is not configured):", email);
    return "logged";
  }
  const response = await fetcher(`${url.replace(/\/$/, "")}/rest/v1/waitlist?on_conflict=email`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Supabase insert failed with HTTP ${response.status}`);
  return "stored";
}
