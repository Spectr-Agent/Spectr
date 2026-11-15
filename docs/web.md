# Spectr landing page (`apps/web`)

A Next.js site for Spectr. FaceTime is the main feature on the page: you call Spectr, say what you need, and watch your Mac's screen on the call. Text is a small side option. The page is a set of full screen slides. It is its own Vercel project and shares nothing with the backend in `services/api`.

## Run it

```sh
cd apps/web
npm install
npm run dev          # http://localhost:3000
npm run build        # runs check:copy first, then builds
npm run check:copy   # the writing rules, on their own
npm run check:style  # the look rules (sharp corners, no shadows), on their own
npm run typecheck
npm test
```

Add `?rm=1` to the address to preview reduced motion, or `?rm=0` to force full motion.

## The slides

Each section fills the screen and the page snaps from one to the next.

| Slide | What it shows |
| --- | --- |
| start | "your computer, on facetime" with a FaceTime call on a phone |
| how it works | four steps for a call |
| use cases | a carousel of four people, each playing their own call |
| demo | the Mac and the call side by side |
| safety | four short promises |
| research | the three big numbers, on a dark slide |
| more research | the other numbers, as a small carousel, each with its source |
| end | the star says hi, text is mentioned as a side option, and the footer |

The change between slides is a scroll linked animation: the slide you leave fades up and the next one rises in. It uses CSS scroll driven animations, so browsers without them simply show the slides with no transition. Reduced motion turns the animation and the snapping off. Dots on the side jump to a slide.

## How it is laid out

| Path | What it holds |
| --- | --- |
| `app/page.tsx` | The page: Nav, SlideNav, Hero, HowItWorks, UseCases, Demo, Safety, Research, MoreResearch, Closing |
| `app/globals.css` | All styles, ported from the prototype. The custom properties are unchanged |
| `content/copy.ts` | Every visible word, the research numbers, and the scripted calls |
| `lib/sources.ts` | Links for the research sources. `null` means the link is not added yet |
| `hooks/useReveal.ts` | One shot scroll reveal |
| `hooks/useThread.ts` | The call engine: shows a script one spoken line at a time. Starting a new script cancels the one running (a token per run) |
| `hooks/useCall.ts` | A thread plus what the Mac's screen is showing in the call video |
| `hooks/useStartOnReveal.ts` | Starts a section's script once, shortly after it first scrolls into view |
| `hooks/useActiveSlide.ts` | Which slide is showing, for the dots |
| `hooks/useReducedMotion.ts` | System setting, `?rm=`, and the prototype shell's `postMessage` toggle |
| `components/` | One file per slide, plus `CallPhone` (the FaceTime screen), `Scene` (the Mac screen in the call video), `Source` and `Reveal` |
| `components/Icon.tsx`, `lib/icons.ts` | Flat line icons with square ends, drawn as SVG paths. Add a name in `lib/icons.ts` to add one |
| `components/Picture.tsx` | A black placeholder block where a photo goes. Its label says what picture belongs there |
| `public/assets/` | The flat logo and star files the page uses |
| `scripts/check-copy.mjs` | The copy checker |
| `scripts/check-style.mjs` | The style checker (see Look) |

The call screen, the Mac windows in the video and the phone frames are HTML and CSS, not images.

### Images

The logo and the little star are the flat black and white versions from `assets/logo/flat/`. Images go through `next/image`. The mascot images are the repo originals and sit in the steps, use cases, safety tiles, start slide and end slide. The black full screen backgrounds behind the start and end slides are `Picture` placeholders with a small label saying what photo to put there.

## Look

Sharp and flat, in the spirit of Waymo's layout with the page's own colors. Helvetica Neue (then Helvetica, then Arial) for text and the system monospace for tiny labels. Square corners everywhere except the phone and the call on it. No shadows, no gradients, no bouncy easing. `npm run check:style` fails the build if any of that comes back (it runs before `next build`, next to `check:copy`).

## Copy rules

`npm run check:copy` scans `content/copy.ts` and fails the build when any of these break:

1. Everything lowercase.
2. No dashes or hyphens of any length. No semicolons.
3. Never the words actually, genuinely or kind.
4. Avoid the words while, rather than and instead of.
5. At most one exclamation point on the whole page.
6. Sentences of 24 words or fewer.

Keep links, class names and anything that is not copy out of `copy.ts`. The GitHub link lives in `lib/site.ts` for that reason (its name has a hyphen).

## Research

The numbers come from the research Sweeya supplied. Three are big on the research slide and the rest are on "more research". Each shows its source. The sources are plain text unless `lib/sources.ts` has a link for them. Only two links are in so far (the Mobile Taskflow study and Babysitting AI Agents, from the team playbook). The statistics have not been independently checked. Some sentences were shortened to meet the copy rules.

## What was removed

The FAQ, the waitlist form and the waitlist API (`/api/waitlist`) are gone, by Sweeya's decision. The page has no sign up. If one comes back, it needs a table and a server route again.

## Vercel

I did not run any Vercel command. Connect it in the dashboard:

1. **Add New Project**, then import `Spectr-Agent/Spectr`.
2. **Root Directory:** `apps/web`.
3. **Framework Preset:** Next.js.
4. **Build and install commands:** leave the defaults. `npm run build` runs `check:copy` first.
5. **Node.js version:** 22.x or newer (the site needs 20.9 or newer).
6. **Environment variable** (name is in `apps/web/.env.example`): `NEXT_PUBLIC_SITE_URL`, the public address, for link previews. Optional.
7. **Ignored Build Step:** leave it empty in the dashboard. `apps/web/vercel.json` sets it so the site only rebuilds when `apps/web`, `assets` or `design-system` change. Check the first few deploys to confirm it behaves.
8. The backend keeps its own Vercel project. `services/api/vercel.json` is untouched.
9. Add the domain in the project settings when you are ready.

## Design tokens: differences

The page keeps its own palette. Almost nothing matches `design-system/tokens/tokens.css`, so no tokens are reused yet:

| Page | Value | Closest design system token | Value |
| --- | --- | --- | --- |
| `--bg` | `#FBF7F0` (warm cream) | `--surface-100` | `#FFFFFF` |
| `--bg2` | `#F5EFE5` | `--surface-200` | `#F4F4F6` |
| `--card` | `#FFFFFF` | `--surface-100` | `#FFFFFF` (same) |
| `--ink` | `#23262D` | `--ink` | `#17171B` |
| `--muted` | `#5D6470` | `--ink-muted` | `#55555F` |
| `--line` | `#EADFCF` | `--border` | `#DADADF` |
| `--blue` | `#A8DEFC` | `--sky` | `#9CCBF0` |
| `--blue2` | `#D8F0FE` | `--clay` | `#DAEAFA` |
| `--blue3` | `#6FC3F2` | none | |
| `--r` | `32px` | `--radius-lg` | `24px` |
| Font | Helvetica Neue | `--font-display` / `--font-sans` | Outfit / Inter |

The design system says "black, white and one light blue". The page adds a warm cream background, a dark research slide, and the iMessage blue and gray in the text example. If the site should follow the design system, that is a design decision for Sweeya.

## Deliberate changes from the prototype

- `.car { overflow-x: clip }`. The carousel's hidden cards sat off screen and made the page wider than a phone, which can let iOS Safari pan sideways. The edge mask already hid them, so nothing looks different.
- **FaceTime redesign.** The prototype was built around texting. The page now leads with a FaceTime call, with the Mac's screen as the call video.
- **Slides and lowercase.** Full screen slides and all copy lowercase.
- **Sharp redesign.** Square corners, flat fills, Helvetica, line icons, black photo placeholders for the start and end backgrounds, and the flat star. The mascots stay.
- The prototype's `.slide` class for the text size slider was renamed `.sizer`, because `.slide` now means a full screen slide.
- Images come from `next/image`. Fonts are system fonts, so there is no font file to load.

## Open items (marked in the code)

1. **Photos.** The black backgrounds behind the start and end slides need real pictures. Each says what picture belongs there.
2. **Password mascot pose.** The passwords tile shows a lock icon until a mascot pose exists. See `content/copy.ts`, "OPEN ITEM 1".
X2. **Example call details.** The names, times and files in the scripted calls are made up. "OPEN ITEM 3".
4. **Research links.** Ten of the twelve sources need a link in `lib/sources.ts`.
5. **FaceTime is shown as working, but it is a scripted preview.** Sweeya decided FaceTime is the main feature and asked for it to be shown before it is built. The team's status table (`docs/native/STATUS.md`) says phone calls and FaceTime have not been tested end to end on a real call. Check that before the link is shared publicly, or add a label such as "coming soon".
6. **Link preview image.** There is no Open Graph image yet.

## What was checked

Run against the production build (`next build`, then `next start`) in headless Chrome on a Mac. It was not run on Vercel, on a real phone, or in Safari.

- **Layout:** no sideways scroll at 390 or 1440, and no console errors on load. Every slide was looked at on desktop.
- **Mobile menu** and **reduced motion** (system setting, `?rm=1`): the menu opens and closes, and with reduced motion nothing animates.
- **Carousel:** arrows, dots, keyboard, swipe, side card click and rapid switching were checked on the earlier build. The carousel code is unchanged, but it was not rerun on the final build.
- **Not checked:** the slide transition itself on a real scroll, the phone layout of the research slides by eye, and the research carousel's behavior.
- `npm run build`, `npm run check:copy`, `npm run check:style`, `npm run typecheck` and `npm test` (26 tests) pass.
