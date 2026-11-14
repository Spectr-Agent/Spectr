# Spectr landing page (`apps/web`)

A Next.js site for Spectr's early access waitlist. FaceTime is the main feature on the page: you call Spectr, say what you need, and watch your Mac's screen on the call. Text is a small side option. It is its own Vercel project and shares nothing with the backend in `services/api`.

## Run it

```sh
cd apps/web
npm install
npm run dev          # http://localhost:3000
npm run build        # runs check:copy first, then builds
npm run check:copy   # the writing rules, on their own
npm run typecheck
npm test
```

Add `?rm=1` to the address to preview reduced motion, or `?rm=0` to force full motion.

## How it is laid out

| Path | What it holds |
| --- | --- |
| `app/page.tsx` | The page: Nav, Hero, HowItWorks, UseCases, Safety, Demo, TextToo, Faq, FinalCta, Footer |
| `app/globals.css` | All styles, ported from the prototype. The custom properties are unchanged |
| `app/api/waitlist/route.ts` | `POST /api/waitlist` |
| `content/copy.ts` | Every visible word, plus the scripted calls (hero, four use cases, demo) |
| `hooks/useReveal.ts` | One shot scroll reveal |
| `hooks/useThread.ts` | The call engine: shows a script one spoken line at a time. Starting a new script cancels the one running (a token per run) |
| `hooks/useCall.ts` | A thread plus what the Mac's screen is showing in the call video |
| `hooks/useStartOnReveal.ts` | Starts a section's script once, shortly after it first scrolls into view |
| `hooks/useReducedMotion.ts` | System setting, `?rm=`, and the prototype shell's `postMessage` toggle |
| `components/` | One file per section, plus `CallPhone` (the FaceTime screen), `Scene` (the Mac screen in the call video) and `Reveal` |
| `public/assets/` | The mascot and logo files the page uses |
| `scripts/check-copy.mjs` | The copy checker |

The call screen, the Mac windows in the video and the phone frames are HTML and CSS, not images.

### Images

All mascot images are the repo originals (`assets/mascot/...@2x.png`). They are pixel for pixel the same as the prototype's copies. The logo is `assets/logo/clay_black_3d/spectr_logo_clay_black_lockup.png` cropped to its artwork, because the original has wide empty margins that would shrink it in the nav. Images go through `next/image`, and Nunito (latin, weights 600 to 900) goes through `next/font/local`.

## Copy rules

`npm run check:copy` scans `content/copy.ts` and fails the build when any of these break:

1. No dashes or hyphens of any length. No semicolons.
2. Never the words actually, genuinely or kind.
3. Avoid the words while, rather than and instead of.
4. At most one exclamation point on the whole page.
5. Sentences of 24 words or fewer.

Keep links, class names and anything that is not copy out of `copy.ts`. The GitHub link lives in `lib/site.ts` for that reason (its name has a hyphen).

## Waitlist

`POST /api/waitlist` with `{ "email": "...", "company": "" }`.

- **Validation:** the email is trimmed, lowercased and checked. Bad input returns 400.
- **Honeypot:** a hidden field named `company`. If it is filled in, the route answers success and stores nothing.
- **Rate limit:** 5 requests per address per 10 minutes, then 429 with `Retry-After`. It is kept in memory, so on serverless hosting each instance counts separately. It slows casual abuse and nothing more.
- **Same origin only:** a request from another site gets 403.
- **No secrets in the browser:** the Supabase key is read on the server only.

### Storage is waiting for approval

Until Sweeya and Poorav approve a table, **nothing is stored**. With no Supabase variables set, the route logs the address to the server console and still returns success. That log line is personal data, so do not share the public URL until the table below is in.

Proposed migration. It is not added to `supabase/migrations`:

```sql
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  constraint waitlist_email_length check (char_length(email) <= 254)
);

-- No policies on purpose: only the server side secret key can read or write.
alter table public.waitlist enable row level security;
```

Once it exists, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in Vercel. The route then inserts with `on_conflict=email`, so a repeated address is ignored.

## Vercel

I did not run any Vercel command. Connect it in the dashboard:

1. **Add New Project**, then import `Spectr-Agent/Spectr`.
2. **Root Directory:** `apps/web`.
3. **Framework Preset:** Next.js.
4. **Build and install commands:** leave the defaults. `npm run build` runs `check:copy` first.
5. **Node.js version:** 22.x or newer (the site needs 20.9 or newer).
6. **Environment variables** (names are in `apps/web/.env.example`):
   - `NEXT_PUBLIC_SITE_URL`: the public address, for link previews. Optional.
   - `SUPABASE_URL` and `SUPABASE_SECRET_KEY`: only after the table is approved. Server only. Never prefix them with `NEXT_PUBLIC_`.
7. **Ignored Build Step:** leave it empty in the dashboard. `apps/web/vercel.json` sets it so the site only rebuilds when `apps/web`, `assets` or `design-system` change. Check the first few deploys to confirm it behaves.
8. The backend keeps its own Vercel project. `services/api/vercel.json` is untouched.
9. Add the domain in the project settings when you are ready.

## Design tokens: differences

The prototype keeps its own palette, as the approved screens show it. Almost nothing matches `design-system/tokens/tokens.css`, so no tokens are reused yet. Nothing was changed silently:

| Prototype | Value | Closest design system token | Value |
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
| Font | Nunito | `--font-display` / `--font-sans` | Outfit / Inter |

Also: the design system README says "black, white and one light blue", while the page adds a warm cream background and the iMessage blue and gray inside the phone mockups (`#0B84FE`, `#E9E9EB`), which imitate Messages. The page has no dark theme. If the site should follow the design system, that is a design decision for Sweeya.

## Deliberate changes from the prototype

- `.car { overflow-x: clip }`. The carousel's hidden cards sat off screen and made the page 373 px wider than a phone, which can let iOS Safari pan sideways. The carousel's edge mask already hid them, so nothing looks different.
- `.foot img { width: auto }`, because `next/image` sets a width attribute.
- The waitlist form posts to the real route instead of showing a fake success.
- The FAQ answers carry `aria-expanded`, `aria-controls` and `inert` while closed.
- Fonts and images come from `next/font` and `next/image`.
- **FaceTime redesign (this version).** The prototype was built around texting. The headline is now "your computer, on FaceTime", the hero and the use case cards show a FaceTime call with the Mac's screen as the video, and text moved to a small "Text works too" band. The old iMessage thread styles were removed. The approved prototype screens described the earlier text design and no longer apply.

## Open items (marked in the code)

1. **Password mascot pose.** The gray "Mascot pose needed: passwords" box in Safety is a placeholder. See `content/copy.ts` and `components/Safety.tsx`, "OPEN ITEM 1".
2. **Pricing and launch date.** The last FAQ answer is placeholder copy with a visible tag. "OPEN ITEM 2".
3. **Example thread details.** The names, times and files in the three scripted threads are made up. "OPEN ITEM 3".
4. **Waitlist table.** Needs Sweeya and Poorav to approve. Until then signups are logged, not stored.
5. **FaceTime is shown as working, but it is a scripted preview.** The calls on the page are made up. Sweeya decided FaceTime is the main feature and asked for it to be shown before it is built. The team's status table (`docs/native/STATUS.md`) says phone calls and FaceTime have not been tested end to end on a real call. Check that before the link is shared publicly, or add a label such as "Coming soon".
6. **Link preview image.** There is no Open Graph image yet.

## What was checked

Run against the production build (`next build`, then `next start`) in headless Chrome on a Mac. It was not run on Vercel, on a real phone, or in Safari. The prototype and the earlier approved screens were removed from `apps/web/_prototype`; they are in the first commit of the `sweeya/landing-page` branch.

- **Layout:** no sideways scroll at 390 or 1440, and no console errors on load or while using the page. The headline fits at 390.
- **Carousel:** arrows, dots, keyboard, swipe both ways, a tiny drag that does nothing, a click on the side card, and rapid switching (the earlier call is cancelled).
- **FAQ, mobile menu and waitlist form** (success, honeypot, rate limit).
- **Reduced motion** (system setting, `?rm=1`, the shell's `postMessage`): captions and the Mac screen show at once, the mascot stays still, and nothing animates.
- `npm run build`, `npm run check:copy`, `npm run typecheck` and `npm test` (43 tests) pass.
