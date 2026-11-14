// When to text progress, decided here and never by the model. A chunk is a
// fixed number of steps. "result" or no preference sends nothing until the end.

import type { UpdateChoice } from "./profile.js";

export const STEPS_PER_CHUNK = 5;

export function shouldSendProgress(updates: UpdateChoice | null, step: number): boolean {
  if (updates === "every_step") return step >= 1;
  if (updates === "every_chunk") return step >= 1 && step % STEPS_PER_CHUNK === 0;
  return false;
}
