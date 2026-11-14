import type { MacStepResponse, TaskState } from "../contracts.js";

export type InboundKind = "task" | "correction" | "answer" | "stop";

export interface AgentMessage {
  role: "assistant" | "user";
  content: unknown;
}

export interface AgentTaskRecord {
  taskId: string;
  ownerId: string;
  deviceId: string;
  state: TaskState;
  revision: number;
  instruction: string;
  question: string | null;
  replyProvider: string | null;
  replyHandle: string | null;
  agentMessages: AgentMessage[];
  pendingToolResults: unknown[];
  stepCount: number;
  lastStepResponse: MacStepResponse | null;
  screenWidth: number | null;
  screenHeight: number | null;
  summary: string | null;
  finalScreenshot: Uint8Array | null;
  finalScreenshotType: string | null;
  resultSentAt: string | null;
  updatedAt: string;
}

export interface PendingInboundMessage {
  providerMessageId: string;
  kind: Exclude<InboundKind, "task" | "stop">;
  text: string;
}

export interface PersistAgentStepInput {
  taskId: string;
  expectedStepCount: number;
  expectedRevision: number;
  stepCount: number;
  state: TaskState;
  question: string | null;
  agentMessages: AgentMessage[];
  pendingToolResults: unknown[];
  lastStepResponse: MacStepResponse;
  screenWidth: number;
  screenHeight: number;
  summary: string | null;
  finalScreenshot: Uint8Array | null;
  finalScreenshotType: string | null;
  consumedInboundIds: string[];
  now: Date;
}
