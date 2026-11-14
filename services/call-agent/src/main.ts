// Runs the call agent as a LiveKit worker. `npm run dev` for local development,
// `npm start` in production. LiveKit dispatches phone calls (via the dispatch rule on
// the Spectr number) and FaceTime calls (via `chert dev --agent <name>`) to this worker
// by its agent name.

import { fileURLToPath } from "node:url";
import { cli, ServerOptions } from "@livekit/agents";

const agentName = process.env.SPECTR_CALL_AGENT_NAME || "spectr-call";

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(new URL("./agent.ts", import.meta.url)),
    agentName,
  }),
);
