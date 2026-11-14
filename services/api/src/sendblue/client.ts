import type { InboundDeps } from "../inbound.js";

export function createSendblueReplier(cfg: {
  apiKeyId: string;
  apiSecretKey: string;
  fromNumber: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}): InboundDeps["sendReply"] {
  const fetcher = cfg.fetch ?? globalThis.fetch;
  const baseUrl = (cfg.baseUrl ?? "https://api.sendblue.com").replace(
    /\/+$/,
    "",
  );

  return async (toNumber, text, _idempotencyKey, mediaUrl) => {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}/api/send-message`, {
        method: "POST",
        headers: {
          "sb-api-key-id": cfg.apiKeyId,
          "sb-api-secret-key": cfg.apiSecretKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          number: toNumber,
          from_number: cfg.fromNumber,
          content: text,
          ...(mediaUrl ? { media_url: mediaUrl } : {}),
        }),
      });
    } catch {
      throw new Error("Sendblue reply request failed");
    }

    if (!response.ok) {
      throw new Error(`Sendblue reply failed with HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return;
    }
    if (
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      body.status === "ERROR"
    ) {
      throw new Error("Sendblue reply failed with status ERROR");
    }
  };
}
