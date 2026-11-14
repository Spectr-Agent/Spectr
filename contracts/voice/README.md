# Spoken replies (ElevenLabs) — iOS client notes

Spectr speaks the agent's status text for one event on a task you own. The client never sends text: it sends the event's `seq`, and the server looks up what may be spoken. There is no way to choose the voice.

| | |
| --- | --- |
| Endpoint | `POST /api/tasks/{taskId}/speech` |
| Auth | `Authorization: Bearer <Supabase access token>` |
| Request body | `{ "seq": 7 }` — extra keys are rejected with 400 |

`speech.fixtures.json` has every request and response body. `sample_slide5.mp3` is a real clip of "Done. Slide five is now on screen." for playback testing before the endpoint is routed.

## Two possible successes — branch on Content-Type

Both are `200`. Check `Content-Type` before touching the body.

- `audio/mpeg` → chunked MP3 stream, 44.1 kHz, 128 kbps, mono. Play it.
- `application/json` with `{ "fallback": true, "text": "..." }` → text-to-speech was slow or failed. Show the text; do not retry for audio.

The server gives up if the first audio chunk has not arrived within **2500 ms** and returns the fallback JSON instead, so it can always answer one way or the other. Measured time-to-first-byte from ElevenLabs is ~320–405 ms on a laptop over home Wi-Fi; budget more on cellular.

## Errors

| Status | Body | Meaning |
| --- | --- | --- |
| 401 | `{"error":"unauthorized"}` | Missing or invalid token |
| 400 | `{"error":"invalid_request"}` | Bad body, or extra keys such as `text` / `voiceId` |
| 404 | `{"error":"not_found"}` | Unknown task, or a task you do not own — the two are deliberately indistinguishable |
| 409 | `{"error":"no_status_text"}` | That event has nothing speakable |

## Client guidance

- **Timeout:** use at least server timeout + 1s, so ≥ 3.5s. On a network failure, show the status text you already have from the event — never block the task on audio.
- **Playback:** `AVPlayer` with the URL streams and starts sooner; for clips this short (~2.4s) downloading first and using `AVAudioPlayer` is simpler and fine. Set `AVAudioSession` category `.playback`, or `.playAndRecord` if push-to-talk is active.
- **Interruption:** Stop or a newer instruction should cancel playback immediately.
- **Do not persist audio.** Responses are `Cache-Control: no-store` and nothing is stored server-side; keep it the same on device.
