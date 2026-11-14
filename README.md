<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/flat/spectr_logo_white_transparent.png">
    <img src="assets/logo/flat/spectr_logo_black_transparent.png" alt="spectr" width="320">
  </picture>
</p>

<p align="center">your computer, by text.</p>

## what it is

spectr is a personal computer agent you can reach while you're away from your computer. text it on imessage, and it does the work on the mac that's set up for it. progress, questions and results come back in the same thread.

spectr only uses the mac it's set up on, and the accounts signed in on that mac. it can't reach any other laptop, or files that aren't on that mac.

## how it works

1. you text a task to spectr's imessage number.
2. the backend sends claude a screenshot of the mac and asks what to do next.
3. the mac clicks, types, scrolls or opens an app or website, then sends a new screenshot.
4. this repeats until the task is done. you get the result in the thread, with a screenshot when it helps.

text `stop` to cancel. any other text during a task corrects it. spectr asks before it sends, posts, buys, submits or deletes anything, and it never types passwords.

## onboarding (planned)

the first time you text spectr, it asks a few questions:

- what you use spectr for
- which computer tasks you want help with
- how you'd like updates
- any accessibility needs

answer in your own words, or skip. you can change your answers later. spectr keeps only what you agree to, tied to your imessage number, and uses it to plan tasks and word its replies. it never limits what you can ask.

## examples

- **student:** "find the slides from this week, put the relevant files in my study folder, and tell me what topics they cover."
- **older person with an accessibility need:** "this website is hard for me to use. help me complete this registration and explain each decision aloud."
- **corporate worker:** "open the report on my computer, update the chart from the latest spreadsheet, and send me a preview."
- **frequent traveler:** "i'm away from my laptop. find the document i was working on, make this change, and show me the result."

## what works today

| | status |
| --- | --- |
| text a task, get the result back | works on poorav's macbook |
| stop or correct a task by text | works |
| ask before sending, buying or submitting; pause for logins | works |
| searches that text back the top options | works |
| a message that arrives twice runs once | works |
| onboarding and saved preferences | not built |
| `status` and `continue` after an interruption | not built |
| mac menu-bar helper (swift) | built, not yet run against the live backend |
| iphone app | sign-in works; live screen and voice not built |
| facetime | not built |
| spectr voice (elevenlabs) | code in `services/api/src/voice`, not connected to imessage |

## setup

spectr needs:

- a mac that stays awake, signed in to the apps and accounts you want it to use
- that mac running the spectr runner, with screen recording and accessibility allowed for terminal
- your imessage number linked to that mac in spectr's database

issue a token for the mac, then start the runner on it:

```sh
POSTGRES_URL=... node services/api/scripts/issue-device-token.mjs <deviceId>
brew install cliclick
cd services/api && npm install
SPECTR_DEVICE_TOKEN=<token> npm run mock-mac -- --api https://spectr-api.vercel.app
```

keep your hands off the mouse and keyboard while it works.

backend checks:

```sh
cd services/api && npm install && npm run typecheck && npm test
```

native apps: [docs/native/SETUP.md](docs/native/SETUP.md).

## team

| | |
| --- | --- |
| poorav | backend, imessage |
| sweeya | agent, wording, brand |
| colby | tests, voice |
| jared | iphone and mac apps |

docs: [requirements](docs/requirements.md), [design](docs/design.md), [tasks](docs/tasks.md).
