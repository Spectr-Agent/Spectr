# Spectr

Spectr is an agent you text from your iPhone. It drives a paired Mac, shows you the live Keynote window, and lets you correct or stop it at any point. The design system keeps that feeling: calm, soft and a little playful, with the clay star mascot as the face of every state.

## Content fundamentals

- Short sentences. Say what the agent is doing right now: "Building slide 4", "Waiting for your answer".
- Speak to the person as "you" and to the agent as "Spectr".
- Errors say what happened and what to tap next: "Spectr lost the Mac. Tap retry or pair again."
- Receipts are plain: what changed, on which window, and when.
- Sentence case everywhere. The product name is written Spectr, with a capital S, and the wordmark is lowercase only inside the logo artwork.

## Visual foundations

- The palette is black, white and one light blue. Most of every screen is white or black with grey text. Light blue (`sky`) is the single accent, and the pale `clay` blue belongs to the mascot. State is carried by words and shape, never by extra hues.
- Corners are generous: `radius-lg` on cards, `radius-pill` on the push to talk button.
- Depth comes from `shadow-clay`, a soft two layer shadow. No hard borders except the hairline `border` token.
- The live viewer, transcript, buttons and status text stay flat. Clay is reserved for the mascot, hero art and state illustrations.
- Type pairs Outfit for display with Inter for text and JetBrains Mono for receipts and pairing codes.

## Mascot states

One star, one camera angle, one lighting setup. Pick the pose by task state. The props are black and light blue:

| State | Asset | Accent beside it |
| --- | --- | --- |
| Welcome and pairing | spectr_welcome | sky |
| Working | spectr_working | clay chip |
| Success and verified receipt | spectr_success | sky chip |
| Error or stalled | spectr_error | black chip |
| Waiting for an answer | spectr_waiting_for_answer | outlined chip |

All poses are in `assets/mascot/`, named by task state.

## Logo

Use the black wordmark on light surfaces and the white wordmark on dark ones. The clay black lockup is for hero moments only. Keep clear space around the logo equal to the height of the star beside it.

## Using the tokens

Always reference tokens by name. In CSS use `var(--sky)` and `var(--radius-lg)`. In SwiftUI use `Spectr.Colors.sky` and `Spectr.Radius.lg`. Every text and surface pairing in the usage notes meets 4.5 to 1 in both themes.

## Repo layout

```
tokens/tokens.json        Source of truth, W3C DTCG format
tokens/tokens.css         CSS variables for light and dark (data-theme="dark" or system setting)
tokens/SpectrTokens.swift SwiftUI colors, spacing and radius that adapt to dark mode
components/               One guideline file per component
previews/                 Open in a browser to see each component with the tokens applied
assets/mascot/            Mascot poses, transparent PNG at 2x
assets/logo/              Logo, icon and app icon files
AGENTS.md                 Instructions for coding agents
```

## Fonts

Outfit (display), Inter (text) and JetBrains Mono (code), all free on Google Fonts. The font files are not stored here.

## Changing a token

Edit `tokens/tokens.json`, then update `tokens.css` and `SpectrTokens.swift` to match. Keep the three files in sync.
