// Postgres versions of the onboarding stores (see supabase/migrations/
// 20261114010000_onboarding.sql). Rows are keyed by the verified owner, and
// everything read back is checked again before it is used.

import type postgres from "postgres";
import { ProfileSchema, type Profile } from "./profile.js";
import { OnboardingStateSchema, type OnboardingState, type OnboardingStore } from "./store.js";
import type { OnboardingTurnLog } from "./turns.js";

function asObject(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

export class PostgresOnboardingStore implements OnboardingStore {
  constructor(private readonly sql: postgres.Sql) {}

  async getState(identity: string): Promise<OnboardingState | null> {
    const [row] = await this.sql`select state from public.onboarding_state where owner_id = ${identity}`;
    if (!row) return null;
    const parsed = OnboardingStateSchema.safeParse(asObject(row.state));
    return parsed.success ? parsed.data : null;
  }

  async putState(identity: string, state: OnboardingState): Promise<void> {
    const json = this.sql.json(OnboardingStateSchema.parse(state) as never);
    await this.sql`
      insert into public.onboarding_state (owner_id, state, updated_at)
      values (${identity}, ${json}, now())
      on conflict (owner_id) do update set state = excluded.state, updated_at = now()
    `;
  }

  async deleteState(identity: string): Promise<void> {
    await this.sql`delete from public.onboarding_state where owner_id = ${identity}`;
  }

  async getProfile(identity: string): Promise<Profile | null> {
    const [row] = await this.sql`select profile from public.profiles where owner_id = ${identity}`;
    if (!row) return null;
    const parsed = ProfileSchema.safeParse(asObject(row.profile));
    return parsed.success ? parsed.data : null;
  }

  async saveProfile(identity: string, profile: Profile): Promise<void> {
    const json = this.sql.json(ProfileSchema.parse(profile) as never);
    await this.sql`
      insert into public.profiles (owner_id, profile, updated_at)
      values (${identity}, ${json}, now())
      on conflict (owner_id) do update set profile = excluded.profile, updated_at = now()
    `;
  }

  async deleteProfile(identity: string): Promise<void> {
    await this.sql`delete from public.profiles where owner_id = ${identity}`;
  }
}

export class PostgresOnboardingTurnLog implements OnboardingTurnLog {
  constructor(private readonly sql: postgres.Sql) {}

  async claim(providerMessageId: string, identity: string): Promise<boolean> {
    const rows = await this.sql`
      insert into public.onboarding_turns (provider_message_id, owner_id)
      values (${providerMessageId}, ${identity})
      on conflict (provider_message_id) do nothing
      returning provider_message_id
    `;
    return rows.length > 0;
  }
}
