// The pipeline: model (or fallback parser) -> Zod -> planned command -> rule gate
// -> one decision. Only allowed contract actions leave as a wire Command.

import { randomUUID } from "node:crypto";
import type { Command, DeviceResult } from "../contracts.js";
import {
  ModelActionSchema,
  isMessageAction,
  toContractCommand,
  type Action,
  type AgentState,
  type MessageAction,
  type PlannedCommand,
  type Settings,
} from "./actions.js";
import type { ModelClient, Screenshot } from "./model.js";
import { parseUtterance } from "./parse.js";
import { evaluate, resultConfirms, type Decision } from "./policy.js";

export interface PlanInput {
  utterance: string;
  state: AgentState;
  settings: Settings;
  screenshot?: Screenshot | null;
}

/** Only these fields are ever logged. */
export interface PlanLogEntry {
  taskId: string;
  commandId: string;
  actionType: string;
  decision: Decision["kind"];
  source: "model" | "fallback";
}

export interface PlanDeps {
  /** Omit or pass null to use only the fallback parser. */
  model?: ModelClient | null;
  newId?: () => string;
  now?: () => Date;
  log?: (entry: PlanLogEntry) => void;
}

export interface PlanResult {
  source: "model" | "fallback";
  decision: Decision;
  /** The message for the user, or null. */
  say: MessageAction | null;
  /** The wire Command to send to the Mac, only when allowed. Validated against contracts.ts. */
  command: Command | null;
  /** The planned command waiting for owner approval, only when needsPermission. */
  pending: PlannedCommand | null;
  /** True when the planner needs fresh Mac state (lookAtScreen) before it can choose. */
  requestState: boolean;
  /** The planned command the gate judged. For logging and tests; never sent anywhere. */
  evaluated: PlannedCommand;
}

const defaultLog = (entry: PlanLogEntry) => console.info(JSON.stringify({ event: "agent.plan", ...entry }));

async function proposeAction(input: PlanInput, deps: PlanDeps): Promise<{ action: Action; source: "model" | "fallback" }> {
  const fallback = () => ({ action: parseUtterance(input.utterance, input.state), source: "fallback" as const });

  // Stop never waits on the model.
  const quick = parseUtterance(input.utterance, input.state);
  if (quick.type === "stop") return { action: quick, source: "fallback" };

  if (!deps.model) return fallback();
  let raw: unknown = null;
  try {
    raw = await deps.model.nextAction({
      utterance: input.utterance,
      state: input.state,
      settings: input.settings,
      screenshot: input.screenshot ?? null,
    });
  } catch {
    raw = null;
  }
  if (raw == null) return fallback();
  const parsed = ModelActionSchema.safeParse(raw);
  return parsed.success ? { action: parsed.data, source: "model" } : fallback();
}

export async function plan(input: PlanInput, deps: PlanDeps = {}): Promise<PlanResult> {
  const newId = deps.newId ?? (() => `cmd_${randomUUID()}`);
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? defaultLog;
  // The owner's own words, used by the secret-typing rule. Overrides anything the caller set.
  const state: AgentState = { ...input.state, ownerMessage: input.utterance };

  const { action, source } = await proposeAction({ ...input, state }, deps);
  const planned: PlannedCommand = {
    commandId: newId(),
    taskId: state.taskId,
    deviceId: state.deviceId,
    revision: state.revision,
    action,
    issuedAt: now().toISOString(),
  };
  let decision = evaluate(planned, state, input.settings);

  const result: PlanResult = {
    source,
    decision,
    say: null,
    command: null,
    pending: null,
    requestState: false,
    evaluated: planned,
  };

  if (decision.kind === "allow") {
    if (isMessageAction(action)) {
      result.say = action;
    } else if (action.type === "lookAtScreen") {
      result.requestState = true;
    } else {
      const wire = toContractCommand(planned);
      if (wire) {
        result.command = wire;
      } else {
        // The gate only allows contract actions; this guards against a contract
        // mismatch (for example a revision below 1) slipping through.
        decision = { kind: "refuse", reason: "That command doesn't fit the task format." };
        result.decision = decision;
        result.say = { type: "refuse", reason: decision.reason };
      }
    }
  } else if (decision.kind === "needsPermission") {
    result.pending = planned;
    result.say = { type: "askPermission", text: decision.reason, forCommandId: planned.commandId };
  } else if (decision.kind === "refuse") {
    result.say = { type: "refuse", reason: decision.reason };
  }

  log({ taskId: state.taskId, commandId: planned.commandId, actionType: action.type, decision: decision.kind, source });
  return result;
}

export interface ResultReply {
  /** True only when a matching DeviceResult shows the requested state. */
  verified: boolean;
  /** Short enough to speak on the call and fit in iMessage. */
  say: MessageAction;
}

function describeDone(command: PlannedCommand | Command, result: DeviceResult): string {
  switch (command.action.type) {
    case "goToSlide":
      return `Slide ${result.observedSlide} is showing.`;
    case "openDemoDeck":
      return "The demo deck is open.";
    case "stop":
      return "Stopped.";
    default:
      return "Done.";
  }
}

/** Decide the reply for the Mac's DeviceResult. Never reports success without a matching result. */
export function handleResult(command: PlannedCommand | Command, result: DeviceResult | null | undefined): ResultReply {
  const check = resultConfirms(command as PlannedCommand, result);
  if (!check.ok || !result) {
    return { verified: false, say: { type: "askQuestion", text: check.ok ? "The Mac hasn't reported back yet." : check.message } };
  }
  return { verified: true, say: { type: "finish", summary: describeDone(command, result) } };
}
