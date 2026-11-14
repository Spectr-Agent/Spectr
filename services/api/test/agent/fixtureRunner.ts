// Shared fixture loading and checks, used by fixtures.test.ts and live.test.ts.
import { expect } from "vitest";
import fixtures from "../../src/agent/fixtures/utterances.json" with { type: "json" };
import type { Action, AgentState, Settings } from "../../src/agent/actions.js";
import type { PlanResult } from "../../src/agent/plan.js";
import { makeState } from "./helpers.js";

export interface Fixture {
  id: string;
  category: string;
  utterance: string;
  state: Partial<AgentState>;
  settings: Settings;
  /** When set, a fake model returns this instead of using the fallback parser. */
  modelOutput?: unknown;
  /** Forces the commandId of the planned command. */
  commandId?: string;
  /** An older queued command re-checked against this state. */
  priorCommand?: { commandId: string; revision: number; issuedAt: string; action: Action; expectedDecision: string };
  expected: { decision: string; action?: Record<string, unknown>; reasonIncludes?: string };
}

export const FIXTURES = fixtures as Fixture[];

export const CATEGORIES = [
  "openDeck",
  "absoluteSlide",
  "nextBack",
  "nextUnknown",
  "correctionBeforeAct",
  "correctionAfterAct",
  "vagueTarget",
  "outOfRange",
  "stop",
  "openAllowedApp",
  "openBlockedApp",
  "passwordField",
  "deleteSettingOn",
  "deleteSettingOff",
  "paymentSettingOff",
  "screenInjection",
  "notOwner",
  "duplicateCommand",
  "stepLimit",
];

export function fixtureState(f: Fixture): AgentState {
  return makeState(f.state);
}

/** The action a fixture's `expected.action` is compared against: the one the gate judged. */
export function judgedAction(r: PlanResult): unknown {
  return r.evaluated.action;
}

export function checkFixture(f: Fixture, r: PlanResult): void {
  expect(r.decision.kind, f.id).toBe(f.expected.decision);
  if (f.expected.action) expect(judgedAction(r), f.id).toMatchObject(f.expected.action);
  if (f.expected.reasonIncludes) {
    expect("reason" in r.decision ? r.decision.reason : "", f.id).toContain(f.expected.reasonIncludes);
  }
}

