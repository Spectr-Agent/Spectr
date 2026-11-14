// Live check against the real Claude API. Skipped unless both are set:
//   SPECTR_LIVE_MODEL=1 ANTHROPIC_API_KEY=sk-... npx vitest run test/agent.live.test.ts
// Costs a little money (about a dozen requests). Never run in CI.
//
// It uses a plain generated screenshot, so it checks Claude's first decision per
// task type and that a long run is accepted by the API. Full end-to-end runs
// with a real screen use the mock Mac (scripts/README.md).

import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MacStepRequestSchema, MacStepResponseSchema, type MacStepRequest, type MacStepResponse } from "../src/contracts.js";
import { createAnthropicCaller, type CallClaude } from "../src/agent/anthropic.js";
import { runAgentStep } from "../src/agent/step.js";
import { InMemoryTaskStore } from "../src/memory-store.js";

const LIVE = process.env.SPECTR_LIVE_MODEL === "1" && Boolean(process.env.ANTHROPIC_API_KEY);
const deviceId = "dev_live_mac";
const ownerId = "owner_live";
const WIDTH = 1280;
const HEIGHT = 800;

/** A plain light-grey PNG, built without any image library. */
function blankPng(width: number, height: number): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0xee)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

const SCREEN = LIVE ? blankPng(WIDTH, HEIGHT) : "";

function request(taskId: string, overrides: Partial<MacStepRequest> = {}): MacStepRequest {
  return MacStepRequestSchema.parse({
    taskId,
    afterStep: 0,
    screenshot: { mediaType: "image/png", data: SCREEN, width: WIDTH, height: HEIGHT },
    results: [],
    ...overrides,
  });
}

async function start(store: InMemoryTaskStore, text: string) {
  const { taskId } = await store.routeInbound({
    providerMessageId: `live-${Math.random()}`,
    ownerId,
    deviceId,
    text,
    replyProvider: "sendblue",
    replyHandle: "+15555550100",
    now: new Date(),
  });
  return taskId;
}

const kinds = (r: MacStepResponse) =>
  r.kind === "actions" ? r.actions.map((a) => a.action.type).join(",") : r.kind === "finished" ? `finished:${r.state}` : "waiting";

describe.skipIf(!LIVE)("live Claude", () => {
  const callClaude: CallClaude = createAnthropicCaller(process.env.ANTHROPIC_API_KEY ?? "");
  const model = process.env.SPECTR_MODEL;

  async function firstStep(text: string) {
    const store = new InMemoryTaskStore();
    const taskId = await start(store, text);
    const r = MacStepResponseSchema.parse(await runAgentStep({ store, deviceId, request: request(taskId), callClaude, model }));
    console.log(`  "${text}" -> ${kinds(r)}${r.kind === "waiting" ? ` ("${r.question}")` : ""}`);
    return r;
  }

  it("first decisions by task type", async () => {
    const results = {
      openApp: await firstStep("open the Notes app"),
      openSite: await firstStep("open youtube.com"),
      vague: await firstStep("open that one"),
    };
    expect(results.openApp).toMatchObject({ kind: "actions" });
    expect(results.openApp.kind === "actions" && results.openApp.actions.some((a) => a.action.type === "openApp")).toBe(true);
    expect(results.openSite.kind === "actions" && results.openSite.actions.some((a) => a.action.type === "openUrl")).toBe(true);
    expect(results.vague.kind).toBe("waiting");
  }, 180_000);

  it("a long run (6+ screenshots) is accepted by the API from start to finish", async () => {
    const store = new InMemoryTaskStore();
    const taskId = await start(
      store,
      "Test run: scroll down once per turn, six turns in a row, taking a screenshot after each scroll. Then call finish with success true and summary 'Scrolled six times.'",
    );
    let r = MacStepResponseSchema.parse(await runAgentStep({ store, deviceId, request: request(taskId), callClaude, model }));
    let step = 0;
    while (r.kind === "actions" && step < 12) {
      step += 1;
      console.log(`  step ${step}: ${kinds(r)}`);
      r = MacStepResponseSchema.parse(
        await runAgentStep({
          store,
          deviceId,
          request: request(taskId, { afterStep: r.step, results: r.actions.map((a) => ({ actionId: a.actionId, ok: true })) }),
          callClaude,
          model,
        }),
      );
    }
    console.log(`  ended: ${kinds(r)} after ${step} steps`);
    // The point: no HTTP 400 from an edited history; the task reaches an end.
    expect(step).toBeGreaterThanOrEqual(4);
    expect(r.kind).toBe("finished");
  }, 600_000);
});
