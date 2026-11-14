import { z } from "zod";
import {
  InboundMessageSchema,
  type InboundMessage,
} from "../contracts.js";

const SendblueMessageSchema = z.object({
  message_handle: z.string().optional(),
  from_number: z.string().optional(),
  content: z.string(),
  is_outbound: z.boolean(),
  status: z.string(),
  group_id: z.string().nullable().optional(),
  date_sent: z.string().datetime(),
  media_url: z.string().nullable().optional(),
});

export function normalizeSendblueMessage(
  payload: unknown,
): InboundMessage | null {
  const message = SendblueMessageSchema.parse(payload);
  if (
    message.is_outbound ||
    (message.group_id !== undefined &&
      message.group_id !== null &&
      message.group_id.length > 0) ||
    message.status !== "RECEIVED" ||
    message.content.trim().length === 0
  ) {
    return null;
  }

  return InboundMessageSchema.parse({
    providerMessageId: message.message_handle,
    fromNumber: message.from_number,
    text: message.content,
    receivedAt: new Date(message.date_sent).toISOString(),
  });
}
