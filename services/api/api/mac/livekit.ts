import { createMacLiveKitRoute } from "../../src/livekit/mac-token.js";

export const GET = createMacLiveKitRoute(() => process.env);
