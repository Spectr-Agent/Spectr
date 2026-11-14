# Spectr design system: instructions for coding agents

Read README.md first. It explains the tone, the palette and the mascot states.

## Rules

* Use only the tokens in `tokens/`. Never write a raw hex value, pixel radius or shadow into UI code.
* The palette is black, white and one light blue (`sky`). Do not add other colors. State is shown with words and shape.
* Every screen must work in light and dark. On the web set `data-theme="dark"` or rely on the system setting. In SwiftUI the colors adapt on their own.
* Primary buttons use `inverse` with `on-inverse` text. Use `sky` for one small highlight at most. Text on `sky` and `clay` uses `on-fill`.
* Cards use `surface-200`, `radius-lg` and `shadow-clay`. The live viewer, transcript and buttons stay flat.
* Pick the mascot pose from `assets/mascot/` by task state: welcome, working, success, error, waiting_for_answer, stopped, listening.
* Fonts: Outfit for display, Inter for text, JetBrains Mono for receipts and pairing codes.
* Touch targets are at least 44 px. Text must keep 4.5 to 1 contrast.

## Where things are

* Web: import `tokens/tokens.css`, then follow `components/` and `previews/`.
* iOS: add `tokens/SpectrTokens.swift` to the target and use `Spectr.Colors`, `Spectr.Spacing` and `Spectr.Radius`.
* Other platforms: read `tokens/tokens.json` (W3C DTCG format).

## Copy

Short sentences. Say what the agent is doing right now. Errors say what happened and what to tap next. Sentence case everywhere. The product name is Spectr.
