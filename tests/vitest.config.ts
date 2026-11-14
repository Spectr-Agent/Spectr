import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      // The coverage provider is resolved from root (the repo root); the package
      // lives in tests/node_modules, so point it there explicitly.
      "@vitest/coverage-v8": fileURLToPath(new URL("./node_modules/@vitest/coverage-v8/dist/index.js", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: "api",
          root: fileURLToPath(new URL("../services/api", import.meta.url)),
          include: ["test/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "call-agent",
          root: fileURLToPath(new URL("../services/call-agent", import.meta.url)),
          include: ["test/**/*.test.ts"],
          environment: "node",
        },
      },
      // apps/web ships its own vitest.config.ts (it carries the "@" alias).
      fileURLToPath(new URL("../apps/web/vitest.config.ts", import.meta.url)),
      {
        test: {
          name: "unit",
          root: repoRoot,
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          // External deps must be inlined or vi.mock cannot intercept them.
          server: { deps: { inline: [/@anthropic-ai/, /livekit-server-sdk/] } },
        },
        resolve: {
          alias: {
            // Same alias apps/web uses, so its modules import cleanly in unit tests.
            "@": fileURLToPath(new URL("../apps/web", import.meta.url)),
            // Unit tests import source from services/api, but bare package
            // specifiers resolve relative to the importing test file; point the
            // mocked SDK boundary at the package's own node_modules.
            "livekit-server-sdk": fileURLToPath(new URL("../services/api/node_modules/livekit-server-sdk/dist/index.js", import.meta.url)),
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: fileURLToPath(new URL("./coverage", import.meta.url)),
      include: [
        "services/api/src/**/*.ts",
        "services/call-agent/src/**/*.ts",
        "tools/dev-agent/server.mjs",
        "apps/web/lib/**/*.ts",
        "apps/web/app/api/**/*.ts",
        "apps/web/scripts/**/*.mjs",
      ],
      exclude: [
        // Type-only declarations, empty file or pure re-export barrels (no runtime code).
        "services/api/src/index.ts",
        "services/api/src/route-deps.ts",
        "services/api/src/agent/types.ts",
        "services/api/src/agent/plan.ts",
        "services/api/src/agent/onboarding/index.ts",
        // LiveKit worker bootstrap: only parses env and calls cli.runApp.
        "services/call-agent/src/main.ts",
        // Needs a real Postgres: the existing pg-store.test.ts skips without TEST_DATABASE_URL.
        "services/api/src/pg-store.ts",
        "services/api/src/agent/onboarding/pg-store.ts",
        // LiveKit runtime glue: driving these requires faking @livekit/agents /
        // @livekit/rtc-node internals (Room, VideoSource, JobContext), not injected deps.
        "services/call-agent/src/agent.ts",
        "services/call-agent/src/screen-relay.ts",
      ],
      // The remaining uncovered statements are unreachable defensive code
      // (agent/routes.ts, agent/step.ts, agent/tools.ts, chert/verify.ts,
      // mock-mac/*); test them only once that code changes.
      thresholds: {
        lines: 99,
        statements: 99,
        functions: 100,
        branches: 90,
      },
    },
  },
});
