import type postgres from "postgres";
import type { CallClaude } from "./agent/anthropic.js";
import type { TaskStore } from "./inbound.js";

export interface RouteOverrides {
  makeStore?: (sql: postgres.Sql) => TaskStore;
  callClaude?: CallClaude;
  fetch?: typeof fetch;
}
