import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/waitlist/route";
import { MAX_BODY_BYTES, RATE_LIMIT, createRateLimiter, normalizeEmail, saveSignup } from "@/lib/waitlist";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeEmail", () => {
  it.each([
    ["Sam@Example.com", "sam@example.com"],
    ["  a.b+tag@mail.co.uk  ", "a.b+tag@mail.co.uk"],
  ])("accepts %j", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each(["", "nope", "a@b", "a@b.c", "two words@x.com", "a@@b.com", `${"a".repeat(250)}@x.com`, 42, null, undefined, { a: 1 }])(
    "rejects %j",
    (input) => {
      expect(normalizeEmail(input)).toBeNull();
    },
  );
});

describe("createRateLimiter", () => {
  it("allows the limit, then blocks until the window passes", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 3 });
    for (let i = 0; i < 3; i += 1) expect(limiter.check("ip", 100 + i).allowed).toBe(true);
    const blocked = limiter.check("ip", 500);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    expect(limiter.check("ip", 1101).allowed).toBe(true);
  });

  it("counts each address separately", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 1).allowed).toBe(false);
  });
});

describe("saveSignup", () => {
  it("logs and stores nothing when Supabase is not configured", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetcher = vi.fn();
    expect(await saveSignup("sam@example.com", { fetcher })).toBe("logged");
    expect(fetcher).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("not stored"), "sam@example.com");
  });

  it("inserts through the server key and ignores duplicates when configured", async () => {
    const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(null, { status: 201 }));
    const result = await saveSignup("sam@example.com", { url: "https://proj.example.co/", key: "secret-key", fetcher: fetcher as unknown as typeof fetch });
    expect(result).toBe("stored");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://proj.example.co/rest/v1/waitlist?on_conflict=email");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ apikey: "secret-key", authorization: "Bearer secret-key", prefer: "resolution=ignore-duplicates,return=minimal" });
    expect(JSON.parse(String(init?.body))).toEqual({ email: "sam@example.com" });
  });

  it("throws, without leaking the key, when Supabase refuses", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(saveSignup("sam@example.com", { url: "https://p.co", key: "secret-key", fetcher: fetcher as unknown as typeof fetch })).rejects.toThrow(
      "HTTP 401",
    );
    await expect(saveSignup("sam@example.com", { url: "https://p.co", key: "secret-key", fetcher: fetcher as unknown as typeof fetch })).rejects.not.toThrow(
      /secret-key/,
    );
  });
});

describe("POST /api/waitlist", () => {
  let counter = 0;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    POST(
      new Request("https://spectr.test/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json", host: "spectr.test", "x-forwarded-for": `203.0.113.${(counter += 1)}`, ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  const quiet = () => vi.spyOn(console, "info").mockImplementation(() => {});

  it("accepts a valid email and logs it when nothing is configured", async () => {
    const info = quiet();
    const response = await post({ email: "Sam@Example.com", company: "" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(info).toHaveBeenCalledWith(expect.any(String), "sam@example.com");
  });

  it("rejects a bad email and a body that is not JSON", async () => {
    quiet();
    const bad = await post({ email: "nope" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "invalid_email" });
    expect((await post("{not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it("says yes to a filled honeypot but stores nothing", async () => {
    const info = quiet();
    const response = await post({ email: "bot@example.com", company: "Acme" });
    expect(response.status).toBe(200);
    expect(info).not.toHaveBeenCalled();
  });

  it("refuses a request from another site", async () => {
    quiet();
    const response = await post({ email: "sam@example.com" }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
  });

  it("accepts a request from the same site", async () => {
    quiet();
    expect((await post({ email: "sam@example.com" }, { origin: "https://spectr.test" })).status).toBe(200);
  });

  it("refuses a body that is too large", async () => {
    quiet();
    const response = await post({ email: "sam@example.com", pad: "x".repeat(MAX_BODY_BYTES) });
    expect(response.status).toBe(413);
  });

  it("limits one address and sends a retry time", async () => {
    quiet();
    const same = { "x-forwarded-for": "198.51.100.9" };
    for (let i = 0; i < RATE_LIMIT.max; i += 1) expect((await post({ email: "sam@example.com" }, same)).status).toBe(200);
    const blocked = await post({ email: "sam@example.com" }, same);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toEqual({ ok: false, error: "rate_limited" });
  });

  it("returns a plain error when saving fails", async () => {
    quiet();
    vi.stubEnv("SUPABASE_URL", "https://proj.example.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post({ email: "sam@example.com" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "server_error" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-key");
    vi.unstubAllEnvs();
  });
});
