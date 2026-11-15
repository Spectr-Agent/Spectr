// Environment for the call agent. Every value is a server-side secret or setting; none
// of it ships in an app.

import { z } from "zod";

const EnvSchema = z.object({
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().min(1),
  POSTGRES_URL: z.string().min(1),
  /** The name LiveKit dispatch rules and `chert dev --agent` use. */
  SPECTR_CALL_AGENT_NAME: z.string().min(1).default("spectr-call"),
  /** LiveKit Inference speech-to-text model. */
  SPECTR_CALL_STT_MODEL: z.string().min(1).default("deepgram/nova-3"),
  /**
   * FaceTime callers arrive without a caller ID today, so a Chert line is bound to one
   * owner by their phone number. Unset means FaceTime calls are declined.
   */
  SPECTR_FACETIME_OWNER_PHONE: z.string().optional(),
  /** What Spectr calls the FaceTime line's owner when greeting them. */
  SPECTR_FACETIME_OWNER_NAME: z.string().optional(),
  /** IANA time zone for "good morning" on calls; the owner's, since callers have no location. */
  SPECTR_OWNER_TIMEZONE: z.string().default("America/New_York"),
  /** Chert project credentials, to read a webhook-answered call until its bridge is ready. */
  CHERT_API_KEY: z.string().optional(),
  CHERT_PROJECT_ID: z.string().optional(),
});

export type CallAgentEnv = z.infer<typeof EnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): CallAgentEnv {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Call agent is missing or has invalid settings: ${missing}`);
  }
  return parsed.data;
}
