# Spectr call agent

A LiveKit voice agent that lets you **call your Mac**: by phone (LiveKit phone number), by FaceTime (Chert), or from the Spectr app. Owner: Jared.

What it does on a call:

1. Identifies the caller and their Mac: phone caller ID, the configured FaceTime owner, or the signed-in app user.
2. Turns each finished sentence into text (LiveKit Inference speech-to-text) and routes it through the **same inbound pipeline as iMessage** (`services/api/src/inbound.ts` → `PostgresTaskStore.routeInbound`): a new task, a correction, an answer or "stop".
3. Speaks short acknowledgements, the agent's questions and the **verified** result, using Colby's ElevenLabs client and pinned voice (`services/api/src/voice`). The caller can talk over it to interrupt.
4. On a FaceTime video call, shows the Mac's shared screen as the call's video: it watches the Mac's room (`spectr-mac-<deviceId>`) and republishes that screen as its own video, because FaceTime shows video only from the participant that speaks.

The agent never plans and never runs anything itself. Planning stays in the backend's Claude step loop, and actions only run on the Mac through `/api/mac/step`.

## Setup

```sh
cd services/call-agent
npm install
cp .env.example .env.local   # fill in; never commit
npm run dev                  # registers as "spectr-call" with LiveKit Cloud
```

| Variable | What it is |
| --- | --- |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The Spectr LiveKit Cloud project |
| `ELEVENLABS_API_KEY` | Same key as the speech endpoint |
| `POSTGRES_URL` | The backend's database (the same one `services/api` uses) |
| `SPECTR_CALL_AGENT_NAME` | Defaults to `spectr-call`; must match the dispatch rule and `chert dev --agent` |
| `SPECTR_CALL_STT_MODEL` | Defaults to `deepgram/nova-3` through LiveKit Inference (billed to the LiveKit project, no extra key) |
| `SPECTR_FACETIME_OWNER_PHONE` | The owner a Chert FaceTime line belongs to; FaceTime calls are declined without it |

## Phone calls

- Number: **+1 (470) 596-9455** (LiveKit Phone Numbers, project `spectr`, inbound only).
- Dispatch rule `SDR_8W7wdqA2EPbJ` ("spectr-call") puts each caller in a new room `spectr-call-…` and dispatches this agent.
- The caller is identified by caller ID, matched against the phone numbers linked for iMessage (`messaging_identities`, provider `sendblue`). Unknown numbers are told so and the call ends.

## FaceTime (Chert)

```sh
npm install -g @trychert/facetime@beta
chert login                         # browser sign-in, once
chert dev --agent spectr-call       # with the three LIVEKIT_ variables exported
```

`chert dev` keeps a warm room with the agent inside and answers calls to your Chert line. The agent stays silent until FaceTime reports it is ready (`chert_bridge_ready` in the room metadata), then greets within Chert's 10-second window. Use FaceTime **Video** to see the Mac's screen; FaceTime Audio works but shows nothing.

Known limit: Chert does not yet pass the caller's identity, so a line is bound to one owner with `SPECTR_FACETIME_OWNER_PHONE`.

## Production

The agent runs on LiveKit Cloud as agent `CA_MqsA9odeGLc5` (us-east). Calls do not depend on anyone's laptop. Merges to `main` that touch `services/call-agent/` or `services/api/src/` deploy automatically via `.github/workflows/deploy-call-agent.yml` (needs the `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` secrets in GitHub); `deploy.sh` still works by hand.

```sh
services/call-agent/deploy/deploy.sh   # deploys committed HEAD; needs lk + the three LIVEKIT_ variables
lk agent status                        # run inside a folder holding deploy/livekit.toml
lk agent logs
```

Its secrets (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `POSTGRES_URL`, `SPECTR_CALL_AGENT_NAME`) are stored on LiveKit Cloud; LiveKit injects its own URL and keys. `POSTGRES_URL` is the `spectr` Supabase project, the same database the Vercel API uses. Stop any local `npm run dev` copy when testing production, or calls may be routed to it.

## Tests

```sh
npm test         # call flow, narration, caller identification, PCM framing
npm run typecheck
```
