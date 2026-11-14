// Runs only with TEST_DATABASE_URL set to a database that has the migrations
// in supabase/migrations applied (same setup as pg-store.test.ts).
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresOnboardingStore, PostgresOnboardingTurnLog } from "../src/agent/onboarding/pg-store.js";
import { emptyProfile } from "../src/agent/onboarding/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = postgres(databaseUrl ?? "postgres://localhost/spectr_test", { prepare: false, max: 2 });
const anna = "00000000-0000-4000-8000-0000000000a1";
const ben = "00000000-0000-4000-8000-0000000000b2";

describe.skipIf(!databaseUrl)("Postgres onboarding stores", () => {
  const store = new PostgresOnboardingStore(sql);
  const turns = new PostgresOnboardingTurnLog(sql);

  beforeEach(async () => {
    await sql`truncate table public.onboarding_turns, public.onboarding_state, public.profiles, auth.users restart identity cascade`;
    await sql`insert into auth.users (id) values (${anna}), (${ben})`;
  });
  afterAll(async () => {
    await sql.end();
  });

  it("keeps state and profile per owner", async () => {
    const draft = { ...emptyProfile(), uses: "homework" };
    await store.putState(anna, { step: "confirming", draft });
    await store.saveProfile(anna, draft);
    expect(await store.getState(anna)).toEqual({ step: "confirming", draft });
    expect(await store.getProfile(anna)).toEqual(draft);
    expect(await store.getState(ben)).toBeNull();
    expect(await store.getProfile(ben)).toBeNull();
  });

  it("overwrites and deletes", async () => {
    await store.saveProfile(anna, { ...emptyProfile(), uses: "one" });
    await store.saveProfile(anna, { ...emptyProfile(), uses: "two" });
    expect((await store.getProfile(anna))?.uses).toBe("two");
    await store.deleteProfile(anna);
    expect(await store.getProfile(anna)).toBeNull();
  });

  it("claims a message only once", async () => {
    expect(await turns.claim("m1", anna)).toBe(true);
    expect(await turns.claim("m1", anna)).toBe(false);
  });
});
