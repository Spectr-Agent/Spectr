# Spectr landing page: handoff to Claude Code

## How to use this file

Run Claude Code inside the Spectr repo and paste the prompt in the next section. The prototype in `prototype/` is the visual and motion reference. `screens/` holds the approved desktop (1440) and phone (390) screens. The goal is a production site in `apps/web` on its own Vercel project.

## Prompt to paste into Claude Code

You are working for Sweeya in the Spectr repo. Her area is brand, so this work lives in a new folder `apps/web`. Read `AGENTS.md` and `design-system/README.md` first.

Task: turn the landing page prototype in `apps/web/_prototype` into a production Next.js site and deploy it on Vercel.

Rules for the repo:
1. Run `git status` first. Create the branch `sweeya/landing-page` from `main`.
2. Keep changes inside `apps/web`, plus one optional doc at `docs/web.md`. Do not edit `contracts/`, `services/`, `apps/ios`, `apps/mac`, `packages/` or `supabase/` without asking Sweeya.
3. Commits and PRs are authored by Sweeya only. Add no Co-Authored-By line and no "Generated with" footer. Do not push. Stop after the local commits and tell Sweeya the exact push command.
4. Do not touch `services/api/vercel.json`. The backend is a separate Vercel project and must keep working.

Stack:
1. Next.js App Router with TypeScript and plain CSS. No UI library and no animation library.
2. Move the CSS from `site.html` into `app/globals.css` and keep the custom properties. Check `design-system/tokens/tokens.css` and reuse tokens where the values match. If a value differs, list the difference for Sweeya instead of forking silently.
3. Split the page into components: Nav, Hero, PhoneThread, HowItWorks, UseCases (carousel), Safety, Demo, Faq, FinalCta, Footer.
4. Port the JavaScript into hooks: `useReveal` (one shot scroll reveal), `useThread` (typing indicator engine with a cancel token), `useReducedMotion` (reads `prefers-reduced-motion` and also accepts the manual toggle used in the prototype shell).
5. Put all visible copy in `content/copy.ts` so it can be checked in one place.
6. Use the mascot and logo files already in the repo (`assets/mascot`, `assets/logo`, `design-system/assets`) and copy only the ones the page needs into `apps/web/public/assets`. The prototype `assets` folder lists which poses go where. Use `next/image` and the Nunito font through `next/font`.
7. Do not use localStorage or sessionStorage.

Behavior that must match the prototype:
1. Hero thread: bubbles appear one at a time with a typing indicator between them. The result screenshot pops in with a soft bounce and the mascot swaps from the working pose to the success pose.
2. Every entrance uses the squash and stretch bounce. Sections fade and rise once.
3. Use cases carousel: swipe, drag, arrows, dots, keyboard and clicking a side card all work. Cards fade and slide left and right. Each switch types out that thread in the phone.
4. Demo: phone and Mac side by side, with the dark mode example.
5. At most one looping animation on screen. Reduced motion shows full threads and a still mascot.
6. Desktop 1440 and phone 390 must match the screens in `screens/`.

Waitlist:
1. Build `POST /api/waitlist` as a route handler in `apps/web`. Validate the email, add a honeypot field and basic rate limiting.
2. Store emails in Supabase through a server only secret key. Propose a `waitlist` table migration and ask Sweeya and Poorav before adding it to `supabase/migrations`. Until they approve, log to the server console and still return success.
3. Never put a secret in client code. Add every new variable name to `apps/web/.env.example` with no values.

Copy rules (enforced by a script):
1. No dashes or hyphens of any length in visible text. No semicolons.
2. Never use the words actually, genuinely or kind.
3. Avoid the words while, rather than and instead of.
4. At most one exclamation point on the whole page.
5. Short sentences and plain words.
6. Add `npm run check:copy` that scans `content/copy.ts` for these rules and fails the build when one breaks.

Honesty: show only features that work today. These are texting a task, getting the result, stop and correct by text, and confirming before risky actions. Label voice, FaceTime, the live iPhone screen and saved preferences "Coming soon" if they ever appear.

Open items to keep visible in the code as clearly marked placeholders:
1. The gray "Mascot pose needed: passwords" box in the Safety section.
2. The last FAQ answer about pricing and launch date.
3. The names and times used in the example threads.

Vercel:
1. Add `apps/web/vercel.json` with an `ignoreCommand` so the site only rebuilds when `apps/web`, `assets` or `design-system` change.
2. Do not run any Vercel command that deploys or links a project. Sweeya connects the project in the dashboard. Write the exact dashboard settings in `docs/web.md`.

Done means:
1. `npm run build` and `npm run check:copy` pass.
2. You ran the site at 1440 and 390 and compared it to `screens/`.
3. No console errors.
4. The final message lists changed paths, the verification commands, what you observed, and one remaining blocker with its owner.

## Steps for Sweeya

1. In Terminal: `cd ~/code/Spectr`, then `git status`, then `git checkout main`, then `git pull`, then `git checkout -b sweeya/landing-page`.
2. Copy the `prototype` and `screens` folders from this handoff into `apps/web/_prototype` and `apps/web/_prototype/screens`. Delete `_prototype` before the pull request.
3. Start Claude Code in the repo root and paste the prompt above.
4. When it finishes, run the site locally and check it against the screens. Then push the branch yourself.
5. In Vercel, choose Add New Project and import `Spectr-Agent/Spectr`. Set Root Directory to `apps/web` and Framework Preset to Next.js. Add the environment variables from `apps/web/.env.example`. The backend project stays untouched.
6. Open the pull request. Vercel posts a preview link on it. Review the preview on a phone and on a laptop, then merge.
7. Add the domain in the Vercel project settings when you are ready.

## Prototype notes

1. `prototype/site.html` is the whole page in one file. `prototype/index.html` is only a viewer with the Desktop and Phone switch and the reduced motion toggle.
2. The prototype assets are resized copies. Prefer the originals in the repo.
3. The Mac screen, the result screenshots and the phone frames are built with HTML and CSS. They are not image assets.
