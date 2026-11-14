// Where onboarding progress and saved profiles live, keyed by the verified
// iMessage identity. One person's data is never reachable with another's key.
// The in-memory version is for tests and local runs; Poorav's database can
// implement the same interface.

import type { Profile } from "./profile.js";
import type { QuestionId } from "./questions.js";

export type OnboardingState =
  | {
      step: "asking";
      question: QuestionId;
      draft: Profile;
      /** They picked "Other"; the next reply says what. */
      awaitingOther: boolean;
      /** After this answer, go back to the "Shall I remember this?" step. */
      returnToConfirm: boolean;
    }
  | { step: "confirming"; draft: Profile }
  /** Picking which answer to change. */
  | { step: "changing"; draft: Profile };

export interface OnboardingStore {
  getState(identity: string): Promise<OnboardingState | null>;
  putState(identity: string, state: OnboardingState): Promise<void>;
  deleteState(identity: string): Promise<void>;
  getProfile(identity: string): Promise<Profile | null>;
  /** Called only after the person says yes. */
  saveProfile(identity: string, profile: Profile): Promise<void>;
  /** For "forget that". */
  deleteProfile(identity: string): Promise<void>;
}

export class InMemoryOnboardingStore implements OnboardingStore {
  private readonly states = new Map<string, OnboardingState>();
  private readonly profiles = new Map<string, Profile>();

  async getState(identity: string) {
    const s = this.states.get(identity);
    return s ? structuredClone(s) : null;
  }
  async putState(identity: string, state: OnboardingState) {
    this.states.set(identity, structuredClone(state));
  }
  async deleteState(identity: string) {
    this.states.delete(identity);
  }
  async getProfile(identity: string) {
    const p = this.profiles.get(identity);
    return p ? structuredClone(p) : null;
  }
  async saveProfile(identity: string, profile: Profile) {
    this.profiles.set(identity, structuredClone(profile));
  }
  async deleteProfile(identity: string) {
    this.profiles.delete(identity);
  }
}
