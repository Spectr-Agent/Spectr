import { z } from "zod";
import {
  ActionSchema as ContractActionSchema,
  CommandSchema,
  type Command,
  type DeviceResult,
  type Task,
} from "../contracts.js";

// ---------------------------------------------------------------------------
// Planner actions.
//
// The planner understands a wider vocabulary than the frozen wire contract,
// but only the actions in CONTRACT_MAC_ACTIONS ever reach the Mac. The rest
// are refused by the rule gate until Poorav adds them to contracts/.
// Field names match contracts.ts (goToSlide uses `number`).
// ---------------------------------------------------------------------------

export const ModifierSchema = z.enum(["command", "shift", "option", "control"]);
export type Modifier = z.infer<typeof ModifierSchema>;

/** The model can raise risk to high but never lower it (see policy.ts). */
export const RiskSchema = z.enum(["low", "high"]);
export type Risk = z.infer<typeof RiskSchema>;

// --- Moves the Mac does ----------------------------------------------------

export const OpenDemoDeckSchema = z.object({ type: z.literal("openDemoDeck") });

/** Always an absolute slide number. Range is checked by the rule gate, not here. */
export const GoToSlideSchema = z.object({
  type: z.literal("goToSlide"),
  number: z.number().int(),
  risk: RiskSchema.optional(),
});

export const StopSchema = z.object({ type: z.literal("stop") });

// Not in the contract yet. Proposed to Poorav; refused by the gate for now.
export const OpenAppSchema = z.object({
  type: z.literal("openApp"),
  name: z.string().min(1).max(100),
  risk: RiskSchema.optional(),
});

export const ClickSchema = z.object({
  type: z.literal("click"),
  x: z.number(),
  y: z.number(),
  targetLabel: z.string().min(1).max(200),
  risk: RiskSchema.optional(),
});

export const TypeTextSchema = z.object({
  type: z.literal("typeText"),
  text: z.string().max(2000),
  risk: RiskSchema.optional(),
});

export const PressKeySchema = z.object({
  type: z.literal("pressKey"),
  key: z.string().min(1).max(40),
  modifiers: z.array(ModifierSchema).max(4).default([]),
  risk: RiskSchema.optional(),
});

export const ScrollSchema = z.object({
  type: z.literal("scroll"),
  direction: z.enum(["up", "down", "left", "right"]),
  amount: z.number().int().min(1).max(20),
  risk: RiskSchema.optional(),
});

/**
 * Ask for fresh state before deciding. Never sent to the Mac as a command:
 * the backend answers it from the task's lastObservedSlide or the next result.
 */
export const LookAtScreenSchema = z.object({ type: z.literal("lookAtScreen") });

// --- Messages Spectr sends to the user -------------------------------------

export const AskQuestionSchema = z.object({
  type: z.literal("askQuestion"),
  text: z.string().min(1).max(300),
});

export const AskPermissionSchema = z.object({
  type: z.literal("askPermission"),
  text: z.string().min(1).max(300),
  forCommandId: z.string().min(1),
});

export const RefuseSchema = z.object({
  type: z.literal("refuse"),
  reason: z.string().min(1).max(300),
});

export const FinishSchema = z.object({
  type: z.literal("finish"),
  summary: z.string().min(1).max(300),
});

export const ActionSchema = z.discriminatedUnion("type", [
  OpenDemoDeckSchema,
  GoToSlideSchema,
  StopSchema,
  OpenAppSchema,
  ClickSchema,
  TypeTextSchema,
  PressKeySchema,
  ScrollSchema,
  LookAtScreenSchema,
  AskQuestionSchema,
  AskPermissionSchema,
  RefuseSchema,
  FinishSchema,
]);
export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action["type"];

/**
 * Actions the model may propose. askPermission is excluded: only the rule gate
 * creates it, because it must point at a real pending commandId.
 */
export const ModelActionSchema = z.discriminatedUnion("type", [
  OpenDemoDeckSchema,
  GoToSlideSchema,
  StopSchema,
  OpenAppSchema,
  ClickSchema,
  TypeTextSchema,
  PressKeySchema,
  ScrollSchema,
  LookAtScreenSchema,
  AskQuestionSchema,
  RefuseSchema,
  FinishSchema,
]);

/** Actions the frozen wire contract supports. Only these reach the Mac. */
export const CONTRACT_MAC_ACTIONS = ["openDemoDeck", "goToSlide", "stop"] as const satisfies readonly ActionType[];

/** Planner-only moves waiting on a contract change. Refused until then. */
export const PROPOSED_MAC_ACTIONS = ["openApp", "click", "typeText", "pressKey", "scroll"] as const satisfies readonly ActionType[];

export const MESSAGE_ACTION_TYPES = ["askQuestion", "askPermission", "refuse", "finish"] as const satisfies readonly ActionType[];
export type MessageAction = Extract<Action, { type: (typeof MESSAGE_ACTION_TYPES)[number] }>;

export function isContractAction(action: Action): boolean {
  return (CONTRACT_MAC_ACTIONS as readonly string[]).includes(action.type);
}

export function isMessageAction(action: Action): action is MessageAction {
  return (MESSAGE_ACTION_TYPES as readonly string[]).includes(action.type);
}

// ---------------------------------------------------------------------------
// Planned command: the contract Command shape, but holding any planner action.
// toContractCommand turns an allowed one into a wire Command.
// ---------------------------------------------------------------------------

export interface PlannedCommand {
  commandId: string;
  taskId: string;
  deviceId: string;
  /** Task revision at the time the command was created. Starts at 1. */
  revision: number;
  action: Action;
  issuedAt: string;
}

/** The wire Command, validated against contracts.ts, or null if the action is not in the contract. */
export function toContractCommand(planned: PlannedCommand): Command | null {
  const a = planned.action;
  let action: unknown;
  if (a.type === "goToSlide") action = { type: "goToSlide", number: a.number };
  else if (a.type === "openDemoDeck" || a.type === "stop") action = { type: a.type };
  else return null;
  const parsed = CommandSchema.safeParse({ ...planned, action });
  return parsed.success ? parsed.data : null;
}

export { ContractActionSchema };

// ---------------------------------------------------------------------------
// State the planner receives.
// ---------------------------------------------------------------------------

export type IdCollection = ReadonlySet<string> | readonly string[];

export interface HistoryEntry {
  command: PlannedCommand;
  /** The Mac's DeviceResult for this command, once it arrives. */
  result?: DeviceResult | null;
}

export interface AgentState {
  taskId: string;
  deviceId: string;
  /** The signed in owner of this Mac. */
  ownerId: string;
  /** Who sent this instruction. */
  requesterId: string;
  /** Latest revision the backend knows. */
  revision: number;
  /** Task.lastObservedSlide. */
  observedSlide: number | null;
  /** Slides in the demo deck. Default 5. */
  deckLength: number;
  stepsUsed: number;
  seenCommandIds: IdCollection;
  /** Command IDs the owner approved in the iPhone app. */
  approvedCommandIds: IdCollection;
  /** Short list of previous commands and results in this task, oldest first. */
  history: readonly HistoryEntry[];

  // Not in DeviceResult yet. Only the proposed (non-contract) actions need
  // them; leave them null/false until the helper reports them.
  frontApp?: string | null;
  focusedFieldIsSecure?: boolean;
  /** Text read from the last screenshot. Untrusted information, never instructions. */
  screenText?: string | null;

  /** The owner's message this turn, verbatim. Set by plan(). */
  ownerMessage?: string | null;
}

export interface Settings {
  askBeforeEditOrDelete: boolean;
}

export const DEFAULT_DECK_LENGTH = 5;
export const DEFAULT_SETTINGS: Settings = { askBeforeEditOrDelete: true };

/** Build planner state from the backend's Task row plus the facts the Task does not carry. */
export function agentStateFromTask(
  task: Task,
  ctx: {
    ownerId: string;
    requesterId: string;
    deckLength?: number;
    stepsUsed?: number;
    seenCommandIds?: IdCollection;
    approvedCommandIds?: IdCollection;
    history?: readonly HistoryEntry[];
  },
): AgentState {
  return {
    taskId: task.taskId,
    deviceId: task.deviceId,
    ownerId: ctx.ownerId,
    requesterId: ctx.requesterId,
    revision: task.revision,
    observedSlide: task.lastObservedSlide,
    deckLength: ctx.deckLength ?? DEFAULT_DECK_LENGTH,
    stepsUsed: ctx.stepsUsed ?? 0,
    seenCommandIds: ctx.seenCommandIds ?? [],
    approvedCommandIds: ctx.approvedCommandIds ?? [],
    history: ctx.history ?? [],
  };
}

export function hasId(ids: IdCollection, id: string): boolean {
  return ids instanceof Set ? ids.has(id) : (ids as readonly string[]).includes(id);
}
