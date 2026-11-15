import type postgres from "postgres";
import type { CallClaude } from "./agent/anthropic.js";
import type { TaskStore } from "./inbound.js";
import type { WakeMac } from "./livekit/wake.js";

export interface RouteOverrides {
  makeStore?: (sql: postgres.Sql) => TaskStore;
  callClaude?: CallClaude;
  fetch?: typeof fetch;
  /** Runs work after the response (defaults to Vercel's `waitUntil`). */
  defer?: (work: Promise<void>) => void;
  /** Wakes a Mac after a text routes a task (defaults to a LiveKit data message). */
  wakeMac?: WakeMac;
  /** Where step timing lines go (defaults to `console.info`). */
  log?: (line: string) => void;
}
