import { createHash, timingSafeEqual } from "node:crypto";

export const SENDBLUE_SIGNING_SECRET_HEADER = "sb-signing-secret";

function headerValue(
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const normalizedName = name.toLowerCase();
  return Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === normalizedName,
  )?.[1];
}

export function verifySendblueSecret(
  headers: Record<string, string | undefined>,
  secret: string,
): boolean {
  const provided = headerValue(headers, SENDBLUE_SIGNING_SECRET_HEADER);
  if (!provided?.trim() || !secret) {
    return false;
  }

  const expectedDigest = createHash("sha256").update(secret, "utf8").digest();
  const providedDigest = createHash("sha256")
    .update(provided, "utf8")
    .digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}
