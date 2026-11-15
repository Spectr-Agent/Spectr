// Regenerates the handoff sample clip in contracts/voice/.
// Run: ELEVENLABS_API_KEY=... node scripts/make-sample-clip.mjs
// Nothing is imported from src/ so this stays runnable without a build step;
// the pinned values below are duplicated and checked against config.ts instead.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pinned = {
  voiceId: "AZnmrjjEOG9CofMyOxaA",
  modelId: "eleven_v4_turbo",
  outputFormat: "mp3_44100_128",
  voiceSettings: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.4,
    use_speaker_boost: true,
    speed: 1.0,
  },
};

const SAMPLE_TEXT = "Done. Slide five is now on screen.";
const configUrl = new URL("../src/voice/config.ts", import.meta.url);
const outputUrl = new URL(
  "../../../contracts/voice/sample_slide5.mp3",
  import.meta.url,
);

async function assertPinnedValuesMatchConfig() {
  const config = await readFile(configUrl, "utf8");
  const mismatches = [];

  for (const [key, value] of [
    ["voiceId", pinned.voiceId],
    ["modelId", pinned.modelId],
    ["outputFormat", pinned.outputFormat],
  ]) {
    if (!config.includes(`"${value}"`)) mismatches.push(`${key} (${value})`);
  }

  for (const [key, value] of Object.entries(pinned.voiceSettings)) {
    const found = config.match(new RegExp(`${key}\\s*:\\s*([\\w.]+)`))?.[1];
    const matches =
      typeof value === "boolean" ? found === String(value) : Number(found) === value;
    if (!matches) mismatches.push(`${key} (${value} vs ${found})`);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `This script is out of sync with src/voice/config.ts: ${mismatches.join(", ")}`,
    );
  }
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set");
  }

  await assertPinnedValuesMatchConfig();

  const url = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${pinned.voiceId}/stream`,
  );
  url.searchParams.set("output_format", pinned.outputFormat);

  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "audio/mpeg",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text: SAMPLE_TEXT,
      model_id: pinned.modelId,
      voice_settings: pinned.voiceSettings,
    }),
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`ElevenLabs returned ${response.status}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(fileURLToPath(outputUrl)), { recursive: true });
  await writeFile(outputUrl, audio);

  console.log(
    `Wrote ${fileURLToPath(outputUrl)} (${audio.byteLength} bytes) in ${Date.now() - startedAt} ms`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
