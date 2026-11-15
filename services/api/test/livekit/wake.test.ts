import { DataPacket_Kind } from "livekit-server-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMacWaker, WAKE_TIMEOUT_MS, WAKE_TOPIC } from "../../src/livekit/wake.js";

const config = { url: "wss://example.livekit.cloud", apiKey: "key", apiSecret: "secret" };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createMacWaker", () => {
  it("does nothing when LiveKit isn't configured", async () => {
    const makeClient = vi.fn();
    const wake = createMacWaker({ url: config.url }, makeClient);
    await expect(wake("mac-1")).resolves.toBeUndefined();
    expect(makeClient).not.toHaveBeenCalled();
  });

  it("sends a reliable data message only to the Mac in its own room", async () => {
    const sendData = vi.fn(async () => {});
    const makeClient = vi.fn(() => ({ sendData }));
    await createMacWaker(config, makeClient)("mac-abc");
    expect(makeClient).toHaveBeenCalledWith("https://example.livekit.cloud", "key", "secret");
    expect(sendData).toHaveBeenCalledWith(
      "spectr-mac-mac-abc",
      new TextEncoder().encode("wake"),
      DataPacket_Kind.RELIABLE,
      { destinationIdentities: ["mac-mac-abc"], topic: WAKE_TOPIC },
    );
  });

  it("maps a ws:// URL to http://", async () => {
    const makeClient = vi.fn(() => ({ sendData: async () => {} }));
    await createMacWaker({ ...config, url: "ws://localhost:7880" }, makeClient)("m");
    expect(makeClient).toHaveBeenCalledWith("http://localhost:7880", "key", "secret");
  });

  it("never throws when the Mac isn't in its room", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const wake = createMacWaker(config, () => ({
      sendData: async () => {
        throw new Error("requested room does not exist");
      },
    }));
    await expect(wake("mac-1")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("Mac wake not delivered", "requested room does not exist");
  });

  it("logs a non-Error failure without its contents", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const wake = createMacWaker(config, () => ({ sendData: () => Promise.reject("boom") }));
    await wake("mac-1");
    expect(log).toHaveBeenCalledWith("Mac wake not delivered", "unknown");
  });

  it("gives up waiting after the timeout", async () => {
    vi.useFakeTimers();
    const wake = createMacWaker(config, () => ({ sendData: () => new Promise<void>(() => {}) }));
    const done = vi.fn();
    const pending = wake("mac-1").then(done);
    await vi.advanceTimersByTimeAsync(WAKE_TIMEOUT_MS - 1);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toHaveBeenCalled();
  });

  it("builds a real LiveKit client by default without sending anything", () => {
    expect(typeof createMacWaker(config)).toBe("function");
  });
});
