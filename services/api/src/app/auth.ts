// Verifies the iPhone's Supabase access token by asking Supabase Auth who it belongs to.
// This works for every signing-key setup the project may use and never needs the JWT
// secret. Results are cached briefly per token so polling does not hit Auth each time.

export interface AppUser {
  userId: string;
  email: string | null;
}

export type VerifyUser = (accessToken: string) => Promise<AppUser | null>;

const CACHE_MS = 60_000;
const MAX_CACHE = 500;

export function createSupabaseUserVerifier(
  config: { url: string; publishableKey: string },
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): VerifyUser {
  const cache = new Map<string, { user: AppUser | null; until: number }>();
  return async (accessToken) => {
    const hit = cache.get(accessToken);
    if (hit && hit.until > now()) return hit.user;
    const response = await fetchImpl(`${config.url.replace(/\/+$/u, "")}/auth/v1/user`, {
      headers: { apikey: config.publishableKey, authorization: `Bearer ${accessToken}` },
    });
    let user: AppUser | null = null;
    if (response.ok) {
      const body = (await response.json()) as { id?: unknown; email?: unknown };
      if (typeof body.id === "string" && /^[0-9a-f-]{36}$/iu.test(body.id)) {
        user = { userId: body.id.toLowerCase(), email: typeof body.email === "string" ? body.email : null };
      }
    } else if (response.status >= 500) {
      throw new Error(`Supabase Auth returned ${response.status}`);
    }
    if (cache.size >= MAX_CACHE) cache.clear();
    // A rejected token is cached for a shorter time so a refreshed one works at once.
    cache.set(accessToken, { user, until: now() + (user ? CACHE_MS : 5_000) });
    return user;
  };
}
