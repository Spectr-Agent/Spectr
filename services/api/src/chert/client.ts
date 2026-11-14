import type { InboundDeps } from "../inbound.js";

export function createChertReplier(cfg: {
  apiKey: string;
  projectId: string;
  lineId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}): InboundDeps["sendReply"] {
  const fetcher = cfg.fetch ?? globalThis.fetch;
  const baseUrl = (cfg.baseUrl ?? "https://app.trychert.com/api/v1").replace(
    /\/+$/,
    "",
  );

  return async (toNumber, text, idempotencyKey) => {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}/shared-messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "X-Chert-Project-Id": cfg.projectId,
          "Idempotency-Key": idempotencyKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          line_id: cfg.lineId,
          recipient: toNumber,
          text,
        }),
      });
    } catch {
      throw new Error("Chert reply request failed");
    }

    if (!response.ok) {
      throw new Error(`Chert reply failed with HTTP ${response.status}`);
    }
  };
}
