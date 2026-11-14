# Local mock Mac loop

1. Start local Postgres and set `POSTGRES_URL` to its database.
2. Apply every file in `supabase/migrations/` to that database.
3. Seed a local device: `node scripts/seed-dev.mjs --phone +14704249734`.
4. Export the printed token as `SPECTR_DEVICE_TOKEN`.
5. Set `ANTHROPIC_API_KEY`, `SPECTR_LINK_SECRET`, and `SPECTR_PUBLIC_URL=http://localhost:3000`.
6. Set dummy Sendblue keys and `SENDBLUE_API_BASE_URL=http://localhost:3000/fake-sendblue`.
7. Set `SENDBLUE_WEBHOOK_SECRET` to a local-only test value.
8. Optionally cap live calls with `MOCK_MAC_MAX_CLAUDE_CALLS=30`.
9. Start the API: `npm run dev:server`.
10. Run the desktop mock: `DISPLAY=:0 npm run mock-mac -- --executor desktop`.
11. Send a local task: `npm run send-text -- --from +14704249734 --text "open instagram.com in the browser"`.
12. Use `--once` to exit after one task finishes.
13. Use `--executor fixture --screenshot /path/to/screenshot.png` for a fixed screenshot.
14. The local server logs outgoing fake Sendblue messages and media URLs.

## Run on your real Mac against production

1. Install `cliclick`: `brew install cliclick`.
2. Grant Terminal Screen Recording and Accessibility permissions in System Settings.
3. Run `cd services/api && npm install && SPECTR_DEVICE_TOKEN=$(cat ~/.spectr-device-token) npm run mock-mac -- --api https://spectr-api.vercel.app`.
4. Text the Sendblue number to start a task. Press Ctrl-C to stop the runner.
