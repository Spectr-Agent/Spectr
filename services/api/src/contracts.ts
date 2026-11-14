import { z } from "zod";

const idSchema = z.string().min(1);
const positiveIntSchema = z.number().int().min(1);
const timestampSchema = z.string().datetime();

export const TaskStateSchema = z.enum([
  "accepted",
  "running",
  "waitingForUser",
  "succeeded",
  "failed",
  "cancelled",
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TaskSchema = z
  .object({
    taskId: idSchema,
    deviceId: idSchema,
    state: TaskStateSchema,
    revision: positiveIntSchema,
    instruction: z.string(),
    lastObservedSlide: positiveIntSchema.nullable(),
    question: z.string().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();
export type Task = z.infer<typeof TaskSchema>;

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("openDemoDeck") }).strict(),
  z
    .object({
      type: z.literal("goToSlide"),
      number: positiveIntSchema,
    })
    .strict(),
  z.object({ type: z.literal("stop") }).strict(),
]);
export type Action = z.infer<typeof ActionSchema>;

export const CommandSchema = z
  .object({
    commandId: idSchema,
    taskId: idSchema,
    deviceId: idSchema,
    revision: positiveIntSchema,
    action: ActionSchema,
    issuedAt: timestampSchema,
  })
  .strict();
export type Command = z.infer<typeof CommandSchema>;

export const ResultOutcomeSchema = z.enum(["succeeded", "failed", "rejected"]);
export type ResultOutcome = z.infer<typeof ResultOutcomeSchema>;

export const DeviceResultSchema = z
  .object({
    commandId: idSchema,
    taskId: idSchema,
    revision: positiveIntSchema,
    outcome: ResultOutcomeSchema,
    observedSlide: positiveIntSchema.nullable(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .strict()
      .nullable(),
    observedAt: timestampSchema,
  })
  .strict();
export type DeviceResult = z.infer<typeof DeviceResultSchema>;

export const ReceiptSchema = z
  .object({
    commandId: idSchema,
    status: z.enum(["recorded", "duplicate", "stale"]),
    taskState: TaskStateSchema,
  })
  .strict();
export type Receipt = z.infer<typeof ReceiptSchema>;

export const EventTypeSchema = z.enum([
  "taskCreated",
  "stateChanged",
  "commandIssued",
  "resultRecorded",
  "question",
  "error",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSchema = z
  .object({
    taskId: idSchema,
    seq: positiveIntSchema,
    type: EventTypeSchema,
    data: z.record(z.unknown()),
    at: timestampSchema,
  })
  .strict();
export type Event = z.infer<typeof EventSchema>;

export const CreateTaskRequestSchema = z
  .object({
    deviceId: idSchema,
    instruction: z.string(),
    source: z.enum(["imessage", "app"]),
  })
  .strict();
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const CreateTaskResponseSchema = z
  .object({
    taskId: idSchema,
    state: TaskStateSchema,
    revision: positiveIntSchema,
  })
  .strict();
export type CreateTaskResponse = z.infer<typeof CreateTaskResponseSchema>;

export const PostInstructionRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      taskId: idSchema,
      expectedRevision: positiveIntSchema,
      kind: z.literal("instruction"),
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      taskId: idSchema,
      expectedRevision: positiveIntSchema,
      kind: z.literal("stop"),
    })
    .strict(),
]);
export type PostInstructionRequest = z.infer<
  typeof PostInstructionRequestSchema
>;

export const PostInstructionResponseSchema = z
  .object({
    taskId: idSchema,
    revision: positiveIntSchema,
    state: TaskStateSchema,
  })
  .strict();
export type PostInstructionResponse = z.infer<
  typeof PostInstructionResponseSchema
>;

export const ErrorCodeSchema = z.enum([
  "staleRevision",
  "notFound",
  "forbidden",
  "invalidRequest",
  "deviceOffline",
  "duplicate",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: ErrorCodeSchema,
        message: z.string(),
        currentRevision: positiveIntSchema.nullable(),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const InboundMessageSchema = z
  .object({
    providerMessageId: idSchema,
    fromNumber: idSchema,
    text: z.string(),
    receivedAt: timestampSchema,
  })
  .strict();
export type InboundMessage = z.infer<typeof InboundMessageSchema>;
