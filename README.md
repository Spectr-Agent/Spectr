<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/flat/spectr_logo_white_transparent.png">
    <img src="assets/logo/flat/spectr_logo_black_transparent.png" alt="spectr" width="320">
  </picture>
</p>

<p align="center">your computer, on call.<br>text it. call it. facetime it. it does the rest, for anyone.</p>

## why spectr

computers still ask a lot of people: small buttons, crowded websites, long forms, steps you have to remember. spectr takes that away. you say what you need in plain words, by imessage or a phone call, and spectr does it on your mac. it tells you what it did in plain words too.

it's built for every age and every kind of work: a student between classes, a grandparent filling out a form, a developer away from their desk, a traveler without their laptop. same assistant, shaped around the person using it.

- **no new app to learn.** if you can send a text or make a call, you can use spectr.
- **plain, calm replies.** short sentences, no jargon.
- **you stay in charge.** text or say `stop` at any time. spectr asks before it sends, posts, buys, submits or deletes anything, and it never types your passwords.
- **made around you.** onboarding (planned) learns how you like updates and any accessibility needs, and uses them in every reply.

## watch it work

most ai agents work out of sight and hand you an answer at the end. spectr works in the open:

- **see your screen from your phone.** watch your mac live while spectr clicks and types.
- **follow every step.** spectr shows what it's doing and why, as it happens, so nothing is a black box.
- **stop it any time.** if it starts going the wrong way, say or text `stop` and it stops.
- **change direction mid-task.** "actually, use the other file." say it on the call or text it, and spectr switches.

you finish real tasks on your own computer, from wherever you are, without guessing what it did.

## who it's for

<table>
<tr>
<td width="55%">

### students

> "find the slides from this week, put the relevant files in my study folder, and tell me what topics they cover."

spectr finds the files, sorts them, and texts back a short list of topics.

</td>
<td width="45%" align="center">
<!-- replace with assets/examples/student.gif -->
<img src="design-system/assets/mascot/spectr_working.png" alt="student example (screenshot coming)" width="220">
</td>
</tr>
<tr>
<td>

### older people and anyone with an accessibility need

> "this website is hard for me to use. help me complete this registration and explain each decision aloud."

spectr fills in the form step by step, explains each choice, and asks before it submits.

</td>
<td align="center">
<!-- replace with assets/examples/accessibility.gif -->
<img src="design-system/assets/mascot/spectr_listening.png" alt="accessibility example (screenshot coming)" width="220">
</td>
</tr>
<tr>
<td>

### developers

> "my build failed. open the pull request on github, read the ci logs, and tell me what broke."

spectr opens the pull request, reads the failing job, and texts back what broke and where. watch from your phone, and redirect it if it heads for the wrong job.

</td>
<td align="center">
<!-- replace with assets/examples/developer.gif -->
<img src="design-system/assets/mascot/spectr_success.png" alt="developer example (screenshot coming)" width="220">
</td>
</tr>
<tr>
<td>

### travelers

> "i'm away from my laptop. find the document i was working on, make this change, and show me the result."

spectr opens the document on your mac, makes the change, and shows you the result.

</td>
<td align="center">
<!-- replace with assets/examples/traveler.gif -->
<img src="design-system/assets/mascot/spectr_waiting_for_answer.png" alt="traveler example (screenshot coming)" width="220">
</td>
</tr>
</table>

these are the experiences we're building toward. see [what works today](#what-works-today) for what runs now.

## what it can reach

spectr only uses the mac it's set up on, and the accounts signed in on that mac. it can't reach any other laptop, or files that aren't on that mac.

## how it works

1. you text or call spectr with a task.
2. the backend sends claude a screenshot of the mac and asks what to do next.
3. the mac clicks, types, scrolls or opens an app or website, then sends a new screenshot.
4. this repeats until the task is done. the result comes back in the thread or on the call.

any new message during a task corrects it.

### calling (in progress)

- **phone:** call +1 (470) 596-9455 from a number linked to your mac.
- **facetime:** facetime video spectr's chert line to see the mac's screen as the call's video.
- **in the app:** planned.

the call agent turns what you say into the same tasks a text creates, and speaks questions and results back in spectr's voice. you can talk over it to interrupt. setup: [services/call-agent](services/call-agent/README.md).

### onboarding (planned)

the first time you text spectr, it asks a few questions: what you use it for, which tasks you want help with, how you'd like updates, and any accessibility needs. answer in your own words, or skip. change your answers any time. spectr keeps only what you agree to, tied to your imessage number, and never limits what you can ask.

## what works today

| | status |
| --- | --- |
| text a task, get the result back | works on poorav's macbook |
| stop or correct a task by text | works |
| ask before sending, buying or submitting; pause for logins | works |
| searches that text back the top options | works |
| a message that arrives twice runs once | works |
| onboarding questions and "shall i remember this?" | built and tested; not connected to imessage, nothing saved to the database yet |
| `status` and `continue` after an interruption | not built |
| mac menu-bar helper (swift) | built, not yet run against the live backend |
| mac screen streaming (livekit) | built and tested locally; not deployed |
| phone calls | number and call agent set up; not tested end to end |
| facetime (chert) | built; not tested on a real call |
| iphone app | sign-in works; live screen and voice not built |
| spectr voice (elevenlabs) | used by the call agent; not used in imessage |

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

more: [call agent](services/call-agent/README.md), [native apps](docs/native/SETUP.md), [design system](design-system/README.md), [example media](assets/examples/README.md).

## team

| | |
| --- | --- |
| poorav | backend, imessage |
| sweeya | agent, wording, brand |
| colby | tests, voice |
| jared | iphone and mac apps, calls |

docs: [requirements](docs/requirements.md), [design](docs/design.md), [tasks](docs/tasks.md).
