import { describe, expect, it } from "vitest";
import type { ModelClient } from "../../src/agent/model.js";
import { plan } from "../../src/agent/plan.js";
import { evaluate } from "../../src/agent/policy.js";
import { CATEGORIES, checkFixture, FIXTURES, fixtureState } from "./fixtureRunner.js";
import { counter, fixedNow, noLog } from "./helpers.js";

describe("fixtures", () => {
  it("cover every category at least 3 times", () => {
    for (const c of CATEGORIES) expect(FIXTURES.filter((f) => f.category === c).length, c).toBeGreaterThanOrEqual(3);
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
  });

  it.each(FIXTURES.map((f) => [f.id, f] as const))("%s", async (_id, f) => {
    const state = fixtureState(f);
    const model: ModelClient | null = f.modelOutput !== undefined ? { nextAction: async () => f.modelOutput } : null;
    const r = await plan(
      { utterance: f.utterance, state, settings: f.settings },
      { model, newId: f.commandId ? () => f.commandId! : counter("fx"), now: fixedNow, log: noLog },
    );
    expect(r.source).toBe(model ? "model" : "fallback");
    checkFixture(f, r);

    if (f.priorCommand) {
      const { expectedDecision, ...prior } = f.priorCommand;
      const old = { taskId: state.taskId, deviceId: state.deviceId, ...prior };
      expect(evaluate(old, state, f.settings).kind, `${f.id} prior`).toBe(expectedDecision);
    }
  });
});
