import type { DeviceResult } from "../../src/contracts.js";
import type { Action, AgentState, PlannedCommand } from "../../src/agent/actions.js";

export const T0 = "2026-11-13T12:00:00.000Z";

export function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    taskId: "tsk_demo_001",
    deviceId: "dev_demo_mac",
    ownerId: "own_demo",
    requesterId: "own_demo",
    revision: 1,
    observedSlide: null,
    deckLength: 5,
    stepsUsed: 0,
    seenCommandIds: [],
    approvedCommandIds: [],
    history: [],
    ...overrides,
  };
}

export function envelope(action: Action, overrides: Partial<PlannedCommand> = {}): PlannedCommand {
  return {
    commandId: "cmd_1",
    taskId: "tsk_demo_001",
    deviceId: "dev_demo_mac",
    revision: 1,
    action,
    issuedAt: T0,
    ...overrides,
  };
}

export function resultFor(cmd: PlannedCommand, overrides: Partial<DeviceResult> = {}): DeviceResult {
  return {
    commandId: cmd.commandId,
    taskId: cmd.taskId,
    revision: cmd.revision,
    outcome: "succeeded",
    observedSlide: null,
    error: null,
    observedAt: T0,
    ...overrides,
  };
}

export function counter(prefix = "cmd"): () => string {
  let i = 0;
  return () => `${prefix}_${++i}`;
}

export const fixedNow = () => new Date(T0);
export const noLog = () => {};
