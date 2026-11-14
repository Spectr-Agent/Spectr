import { z } from "zod";

const idSchema = z.string().min(1);
const positiveIntSchema = z.number().int().min(1);
const nonNegativeIntSchema = z.number().int().min(0);
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

const modifierSchema = z.enum(["cmd", "option", "ctrl", "shift"]);
const modifiersSchema = z
  .array(modifierSchema)
  .max(4)
  .refine((modifiers) => new Set(modifiers).size === modifiers.length);
const coordinateSchema = z.number().int().min(0);
const keyComboSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((combo) => {
    if (combo === "+") {
      return true;
    }
    const parts = combo.split("+");
    if (parts.some((part) => part.length === 0)) {
      return false;
    }
    const key = parts.pop()!;
    const modifiers = parts;
    if (
      modifiers.some(
        (modifier) =>
          !["cmd", "option", "ctrl", "shift"].includes(modifier),
      ) ||
      new Set(modifiers).size !== modifiers.length
    ) {
      return false;
    }
    if (
      [
        "return",
        "tab",
        "escape",
        "space",
        "delete",
        "forwardDelete",
        "up",
        "down",
        "left",
        "right",
        "home",
        "end",
        "pageUp",
        "pageDown",
      ].includes(key) ||
      /^f(?:[1-9]|1[0-2])$/u.test(key)
    ) {
      return true;
    }
    return (
      [...key].length === 1 &&
      !/[\p{Cc}\p{Cf}]/u.test(key)
    );
  });

const httpUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname.length > 0
      );
    } catch {
      return false;
    }
  });

export const MacActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("screenshot") }).strict(),
  z
    .object({
      type: z.literal("click"),
      x: coordinateSchema,
      y: coordinateSchema,
      button: z.enum(["left", "right", "middle"]),
      clicks: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      modifiers: modifiersSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("mouseMove"),
      x: coordinateSchema,
      y: coordinateSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("drag"),
      fromX: coordinateSchema,
      fromY: coordinateSchema,
      toX: coordinateSchema,
      toY: coordinateSchema,
      modifiers: modifiersSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("scroll"),
      x: coordinateSchema.nullable(),
      y: coordinateSchema.nullable(),
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().int().min(1).max(50),
      modifiers: modifiersSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("type"),
      text: z
        .string()
        .min(1)
        .max(2000)
        .refine((value) => !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)),
    })
    .strict(),
  z
    .object({
      type: z.literal("key"),
      keys: keyComboSchema,
      repeat: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("wait"),
      seconds: z.number().min(0).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal("openApp"),
      name: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[\p{L}\p{N} .&'()+-]+$/u),
    })
    .strict(),
  z
    .object({ type: z.literal("openUrl"), url: httpUrlSchema })
    .strict(),
]);
export type MacAction = z.infer<typeof MacActionSchema>;

export const MacStepScreenshotSchema = z
  .object({
    mediaType: z.enum(["image/png", "image/jpeg"]),
    data: z
      .string()
      .min(1)
      .max(4_000_000)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
    width: positiveIntSchema,
    height: positiveIntSchema,
  })
  .strict()
  .superRefine((screenshot, ctx) => {
    if (Math.max(screenshot.width, screenshot.height) > 2576) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Screenshot long edge must be at most 2576 pixels",
      });
    }
    if (
      Math.ceil(screenshot.width / 28) *
        Math.ceil(screenshot.height / 28) >
      4784
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Screenshot exceeds the Anthropic image block limit",
      });
    }
  });

export const MacStepRequestSchema = z
  .object({
    taskId: idSchema,
    afterStep: nonNegativeIntSchema,
    screenshot: MacStepScreenshotSchema,
    results: z
      .array(
        z
          .object({
            actionId: idSchema,
            ok: z.boolean(),
            error: z.string().max(500).optional(),
            output: z.string().max(1000).optional(),
          })
          .strict(),
      )
      .max(50),
    /** Optional: the Keynote slide showing, when the front app is Keynote. Older clients omit it. */
    observedSlide: positiveIntSchema.nullable().optional(),
  })
  .strict();
export type MacStepRequest = z.infer<typeof MacStepRequestSchema>;

const MacStepActionResultSchema = z
  .object({
    actionId: idSchema,
    action: MacActionSchema,
  })
  .strict();

export const MacStepResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("actions"),
      taskId: idSchema,
      step: nonNegativeIntSchema,
      revision: positiveIntSchema,
      actions: z.array(MacStepActionResultSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("waiting"),
      taskId: idSchema,
      step: nonNegativeIntSchema,
      question: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("finished"),
      taskId: idSchema,
      step: nonNegativeIntSchema,
      state: z.enum(["succeeded", "failed", "cancelled"]),
      summary: z.string(),
    })
    .strict(),
]);
export type MacStepResponse = z.infer<typeof MacStepResponseSchema>;

export const MacTaskResponseSchema = z
  .object({
    task: z
      .object({
        taskId: idSchema,
        revision: positiveIntSchema,
        state: TaskStateSchema,
        instruction: z.string(),
        step: nonNegativeIntSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type MacTaskResponse = z.infer<typeof MacTaskResponseSchema>;

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
  "staleStep",
  "notFound",
  "forbidden",
  "invalidRequest",
  "deviceOffline",
  "duplicate",
  "upstreamError",
  "misconfigured",
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
