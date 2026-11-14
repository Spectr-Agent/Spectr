import { describe, expect, it, vi } from "vitest";
import { createSupabaseUserVerifier } from "../../../../../services/api/src/app/auth.js";
import { appError, appJson, bearer, missingEnv, readJson } from "../../../../../services/api/src/app/http.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("createSupabaseUserVerifier", () => {
  const verifier = (fetchImpl: typeof fetch, now: () => number = Date.now) =>
    createSupabaseUserVerifier({ url: "https://sb.test/", publishableKey: "pk" }, fetchImpl, now);

  it("returns the user for a valid token and caches it", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: UUID.toUpperCase(), email: "a@b.c" }), { status: 200 }),
    );
    const verify = verifier(fetchImpl as typeof fetch);
    expect(await verify("tok")).toEqual({ userId: UUID, email: "a@b.c" });
    expect(await verify("tok")).toEqual({ userId: UUID, email: "a@b.c" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://sb.test/auth/v1/user");
    expect((init.headers as Record<string, string>).apikey).toBe("pk");
  });

  it.each([
    [{ id: "not-a-uuid" }],
    [{ email: "a@b.c" }],
    [{}],
  ])("returns null for a malformed user %j", async (body) => {
    const verify = verifier((async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch);
    expect(await verify("tok")).toBeNull();
  });

  it("treats non-string email as null", async () => {
    const verify = verifier((async () => new Response(JSON.stringify({ id: UUID, email: 5 }), { status: 200 })) as typeof fetch);
    expect(await verify("tok")).toEqual({ userId: UUID, email: null });
  });

  it("returns null for a rejected token and caches the rejection briefly", async () => {
    let time = 0;
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    const verify = verifier(fetchImpl as typeof fetch, () => time);
    expect(await verify("bad")).toBeNull();
    time += 10_000; // past the 5s negative cache, before the 60s positive one
    expect(await verify("bad")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws on a Supabase outage", async () => {
    const verify = verifier((async () => new Response("x", { status: 503 })) as typeof fetch);
    await expect(verify("tok")).rejects.toThrow("503");
  });

  it("clears the cache once it is full", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: UUID }), { status: 200 }));
    const verify = verifier(fetchImpl as typeof fetch);
    for (let i = 0; i < 501; i += 1) await verify(`tok${i}`);
    // The first token was evicted wholesale, so it is fetched again.
    await verify("tok0");
    expect(fetchImpl.mock.calls.length).toBe(502);
  });
});

describe("http helpers", () => {
  it("appError and appJson serialize bodies", async () => {
    const err = appError(400, "invalidRequest", "nope");
    expect(err.status).toBe(400);
    expect(await err.json()).toMatchObject({ error: { code: "invalidRequest" } });
    const ok = appJson({ a: 1 });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.json()).toEqual({ a: 1 });
  });

  it("readJson returns undefined on malformed bodies", async () => {
    expect(await readJson(new Request("http://x", { method: "POST", body: "not json" }))).toBeUndefined();
    expect(await readJson(new Request("http://x", { method: "POST", body: '{"a":1}' }))).toEqual({ a: 1 });
  });

  it("bearer extracts only well-formed tokens", () => {
    const req = (header: string | null) =>
      new Request("http://x", { headers: header ? { authorization: header } : {} });
    expect(bearer(req("Bearer abc"))).toBe("abc");
    expect(bearer(req("bearer abc"))).toBeNull();
    expect(bearer(req("Bearer a b"))).toBeNull();
    expect(bearer(req(null))).toBeNull();
  });

  it("missingEnv reports and answers", async () => {
    expect(missingEnv({ A: "1" }, ["A"])).toBeNull();
    const response = missingEnv({ A: "1" }, ["A", "B", "C"]);
    expect(response?.status).toBe(500);
    expect(await response?.json()).toMatchObject({ error: { code: "misconfigured" } });
  });
});
