// Optional: runs the fixtures against the real Claude API.
// Skipped unless SPECTR_LIVE_MODEL=1. Costs money; never run it in CI.
//   SPECTR_LIVE_MODEL=1 ANTHROPIC_API_KEY=... npx vitest run test/agent/live.test.ts

import { describe, it } from "vitest";
import { createClaudeModelClient } from "../../src/agent/model.js";
import { plan } from "../../src/agent/plan.js";
import { checkFixture, FIXTURES, fixtureState } from "./fixtureRunner.js";
import { counter, noLog } from "./helpers.js";

const LIVE = process.env.SPECTR_LIVE_MODEL === "1";

describe.skipIf(!LIVE)("live model fixtures", () => {
  it(
    "prints a pass count per category",
    async () => {
      const model = createClaudeModelClient();
      const tally = new Map<string, { pass: number; total: number; fallback: number }>();
      for (const f of FIXTURES.filter((x) => x.modelOutput === undefined)) {
        const t = tally.get(f.category) ?? { pass: 0, total: 0, fallback: 0 };
        t.total++;
        const r = await plan(
          { utterance: f.utterance, state: fixtureState(f), settings: f.settings },
          { model, newId: f.commandId ? () => f.commandId! : counter("live"), log: noLog },
        );
        if (r.source === "fallback") t.fallback++;
        try {
          checkFixture(f, r);
          t.pass++;
        } catch {
          // counted as a miss
        }
        tally.set(f.category, t);
      }
      console.table(Object.fromEntries(tally));
    },
    600_000,
  );
});
