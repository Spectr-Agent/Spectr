import { z } from "zod";
import {
  InboundMessageSchema,
  type InboundMessage,
} from "../contracts.js";

const ChertEventTypeSchema = z.object({ event_type: z.string() });

export const ChertMessageReceivedSchema = z.object({
  event_id: z.string().min(1),
  created_at: z.string().datetime(),
  event_type: z.literal("message.received"),
  data: z.object({
    chat: z.object({
      is_group: z.boolean(),
    }),
    message: z.object({
      direction: z.string(),
      sender_handle: z.object({
        handle: z.string().min(1),
      }),
      parts: z.array(
        z.object({
          type: z.string(),
          value: z.string().optional(),
        }),
      ),
      sent_at: z.string().datetime().nullable().optional(),
    }),
  }),
});

export function normalizeChertEvent(payload: unknown): InboundMessage | null {
  const { event_type: eventType } = ChertEventTypeSchema.parse(payload);
  if (eventType !== "message.received") {
    return null;
  }

  const event = ChertMessageReceivedSchema.parse(payload);
  const { chat } = event.data;
  const { message } = event.data;
  if (message.direction !== "inbound" || chat.is_group) {
    return null;
  }

  const text = message.parts
    .filter(
      (part) =>
        part.type === "text" &&
        part.value !== undefined &&
        part.value.trim().length > 0,
    )
    .map((part) => part.value!)
    .join("\n");
  if (!text) {
    return null;
  }

  return InboundMessageSchema.parse({
    providerMessageId: event.event_id,
    fromNumber: message.sender_handle.handle,
    text,
    receivedAt: message.sent_at ?? event.created_at,
  });
}
