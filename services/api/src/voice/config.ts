export const voiceConfig = Object.freeze({
  voiceId: "ynTHHllfDmGsZ3G8QJt9",
  voiceName: "Daniel",
  modelId: "eleven_flash_v2_5",
  voiceSettings: Object.freeze({
    stability: 0.55,
    similarity_boost: 0.75,
    style: 0,
    use_speaker_boost: true,
    speed: 1.0,
  }),
  outputFormat: "mp3_44100_128",
  contentType: "audio/mpeg",
  timeoutMs: 2500,
  maxTextChars: 300,
} as const);

export function loadVoiceEnv(env: NodeJS.ProcessEnv = process.env): { apiKey: string } {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  const voiceId = env.ELEVENLABS_VOICE_ID;
  if (voiceId && voiceId !== voiceConfig.voiceId) {
    throw new Error("ELEVENLABS_VOICE_ID does not match the pinned voiceConfig.voiceId");
  }
  return { apiKey };
}
