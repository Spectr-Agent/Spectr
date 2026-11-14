// Deterministic fallback parser. No model, no network. Its output still goes
// through the rule gate in policy.ts.

import type { Action, AgentState } from "./actions.js";

export const PARSER_WORDS = {
  stop: ["stop", "cancel", "cancel that", "hold on", "halt", "abort", "never mind", "nevermind"],
  /** Stripped from the start, repeatedly, before parsing the rest. */
  correction: ["change it to", "make it", "i meant", "i mean", "actually", "sorry", "nope", "wait", "no"],
  /** Polite or filler words stripped from the start. */
  filler: ["please", "spectr", "ok", "okay", "can you", "could you", "go to", "jump to", "switch to", "show me", "show", "the"],
  numbers: {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20,
    // Common speech-to-text mistakes.
    for: 4, fore: 4, to: 2, too: 2, won: 1,
  } as Record<string, number>,
  next: ["next", "next slide", "next one", "forward", "go forward"],
  back: ["back", "go back", "previous", "previous slide", "previous one", "back one"],
  vague: ["that one", "the good one", "good one", "the other one", "other one", "that slide", "this one"],
  openVerbs: ["open", "launch", "start"],
} as const;

const SPEECH_MISTAKES = new Set(["for", "fore", "to", "too", "won"]);
const BARE_NUMBER_WORDS = new Set(Object.keys(PARSER_WORDS.numbers).filter((w) => !SPEECH_MISTAKES.has(w)));

export const UNKNOWN_REPLY = "I did not understand that. Try: open an app, go to slide 4, or stop.";
export const VAGUE_REPLY = "Which slide number?";

function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPrefixes(text: string, prefixes: readonly string[]): string {
  let out = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of prefixes) {
      if (out === p) return "";
      if (out.startsWith(`${p} `)) {
        out = out.slice(p.length + 1).trim();
        changed = true;
      }
    }
  }
  return out;
}

function toNumber(word: string | undefined): number | null {
  if (!word) return null;
  if (/^\d+$/.test(word)) return Number(word);
  return PARSER_WORDS.numbers[word] ?? null;
}

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function relative(state: AgentState, delta: 1 | -1): Action {
  if (state.observedSlide == null) return { type: "lookAtScreen" };
  return { type: "goToSlide", number: state.observedSlide + delta };
}

export function parseUtterance(text: string, state: AgentState): Action {
  const cleaned = clean(text);

  // 1. Stop words win anywhere in the message.
  if (PARSER_WORDS.stop.some((w) => hasPhrase(cleaned, w))) return { type: "stop" };

  // 2. Correction words at the start, then polite filler.
  const rest = stripPrefixes(stripPrefixes(cleaned, PARSER_WORDS.correction), PARSER_WORDS.filler);

  // 3. Open the deck.
  if (/^(open|launch|start) (the )?(demo |practice )?(deck|slides|presentation)$/.test(rest)) {
    return { type: "openDemoDeck" };
  }

  // 5. First and last.
  if (/^(first|1st) (slide|one)$/.test(rest) || rest === "first" || rest === "beginning") {
    return { type: "goToSlide", number: 1 };
  }
  if (/^(last|final) slide$/.test(rest) || rest === "last" || rest === "end") {
    return { type: "goToSlide", number: state.deckLength };
  }

  // 4. Slide numbers: "slide 4", "slide four", "slide number four", or a bare number after a correction.
  const slideMatch = /^(?:slide|page) (?:number |no )?([a-z0-9]+)$/.exec(rest);
  if (slideMatch) {
    const n = toNumber(slideMatch[1]);
    if (n != null) return { type: "goToSlide", number: n };
  }
  // A bare number ("actually five", "make it 3"). Speech-mistake words like "to"
  // only count after the word "slide", so they are excluded here.
  if (/^\d+$/.test(rest) || BARE_NUMBER_WORDS.has(rest)) {
    return { type: "goToSlide", number: toNumber(rest)! };
  }

  // 6. Next and back, converted to absolute numbers.
  if ((PARSER_WORDS.next as readonly string[]).includes(rest)) return relative(state, 1);
  if ((PARSER_WORDS.back as readonly string[]).includes(rest)) return relative(state, -1);

  // 7. Vague targets.
  if (PARSER_WORDS.vague.some((w) => rest === w || rest.startsWith(`${w} `)) || /^(the )?one (with|about|that) /.test(rest)) {
    return { type: "askQuestion", text: VAGUE_REPLY };
  }

  // 8. Open an app. Keep the user's original casing for the name.
  const openMatch = /^(open|launch|start) (?:the )?(?:app )?(.+?)(?: app)?$/.exec(rest);
  if (openMatch?.[2]) {
    const original = /\b(?:open|launch|start)\s+(?:the\s+)?(?:app\s+)?(.+?)(?:\s+app)?[\s.!?]*$/i.exec(text.trim());
    const name = (original?.[1] ?? openMatch[2]).trim().slice(0, 100);
    if (name) return { type: "openApp", name };
  }

  // 9. Anything else.
  return { type: "refuse", reason: UNKNOWN_REPLY };
}
