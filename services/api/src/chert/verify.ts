import { createHmac, timingSafeEqual } from "node:crypto";

function headerValue(
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const normalizedName = name.toLowerCase();
  return Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === normalizedName,
  )?.[1];
}

export function verifyChertSignature(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
  opts?: { nowSeconds?: number; toleranceSeconds?: number },
): boolean {
  try {
    const newHeader = headerValue(headers, "X-Webhook-Signature");
    const legacyHeader = headerValue(headers, "x-chert-signature");
    const signatureHeader = newHeader ?? legacyHeader;
    if (signatureHeader === undefined) {
      return false;
    }

    const match =
      newHeader !== undefined
        ? /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader.trim())
        : /^v1,(\d+),([0-9a-f]{64})$/.exec(signatureHeader.trim());
    if (!match) {
      return false;
    }

    const timestampText = match[1];
    const timestamp = Number(timestampText);
    const signatureHex = match[2];
    const nowSeconds = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
    const toleranceSeconds = opts?.toleranceSeconds ?? 300;
    if (
      !Number.isSafeInteger(timestamp) ||
      !Number.isFinite(nowSeconds) ||
      !Number.isFinite(toleranceSeconds) ||
      toleranceSeconds < 0 ||
      Math.abs(nowSeconds - timestamp) > toleranceSeconds
    ) {
      return false;
    }

    const expected = createHmac("sha256", secret)
      .update(`${timestampText}.${rawBody}`, "utf8")
      .digest();
    const provided = Buffer.from(signatureHex, "hex");
    if (expected.length !== provided.length) {
      return false;
    }
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}
