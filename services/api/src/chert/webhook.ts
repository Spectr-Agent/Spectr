import { ZodError } from "zod";
import { handleInboundMessage, type InboundDeps } from "../inbound.js";
import { normalizeChertEvent } from "./normalize.js";
import { verifyChertSignature } from "./verify.js";

export async function handleChertWebhook(
  req: {
    rawBody: string;
    headers: Record<string, string | undefined>;
  },
  deps: {
    secret: string;
    inbound: InboundDeps;
    nowSeconds?: number;
  },
): Promise<{
  status: number;
  body: {
    ok: boolean;
    outcome?: string;
    taskId?: string;
    error?: string;
  };
}> {
  if (
    !verifyChertSignature(req.rawBody, req.headers, deps.secret, {
      nowSeconds: deps.nowSeconds,
    })
  ) {
    return { status: 401, body: { ok: false, error: "invalidSignature" } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(req.rawBody) as unknown;
  } catch {
    return { status: 400, body: { ok: false, error: "invalidJson" } };
  }

  try {
    const message = normalizeChertEvent(payload);
    if (!message) {
      return { status: 200, body: { ok: true, outcome: "ignored" } };
    }

    const outcome = await handleInboundMessage(message, deps.inbound);
    if (outcome.status === "ignored") {
      return { status: 200, body: { ok: true, outcome: "ignored" } };
    }
    if (outcome.status === "onboarding") {
      return { status: 200, body: { ok: true, outcome: "onboarding" } };
    }
    return {
      status: 200,
      body: { ok: true, outcome: outcome.status, taskId: outcome.taskId },
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return { status: 400, body: { ok: false, error: "invalidPayload" } };
    }
    throw error;
  }
}
