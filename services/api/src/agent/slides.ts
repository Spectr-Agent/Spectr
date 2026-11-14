// Keynote is one example task. When the owner asks for a specific slide, the
// Mac can report the slide that is actually showing (`observedSlide`), and the
// agent only reports success if they match. Everything else about the task
// stays general: this file never decides what to do, only what to check.

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  // Common speech-to-text mistakes after the word "slide".
  for: 4, fore: 4, to: 2, too: 2, won: 1,
};

/** The slide number a single message asks for, or null if it doesn't name one. */
export function slideFromText(text: string): number | null {
  const t = text.toLowerCase().replace(/[^a-z0-9#\s]/g, " ").replace(/\s+/g, " ");
  const after = /\bslide (?:number |no |#)?([a-z]+|\d+)\b/.exec(t);
  const before = /\b(first|second|third|fourth|fifth)(?: slide)\b/.exec(t);
  const word = after?.[1] ?? before?.[1];
  if (!word) return null;
  const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];
  return n && n >= 1 && n <= 999 ? n : null;
}

const INSTRUCTION = /^Task from the user: "([\s\S]*)"\nCurrent screen:$/;
const CORRECTION = /^The user sent a correction: "([\s\S]*)"$/;

/**
 * The slide the newest instruction asks for, read from the stored conversation.
 * The original task counts first, then each correction in order; the newest
 * one wins. A correction that names no slide (say "actually open YouTube")
 * clears the target, so the check only applies to slide tasks.
 */
export function targetSlide(messages: ReadonlyArray<{ role: string; content: unknown }>): number | null {
  let target: number | null = null;
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block?.type !== "text" || typeof block.text !== "string") continue;
      const m = INSTRUCTION.exec(block.text) ?? CORRECTION.exec(block.text);
      if (m) target = slideFromText(m[1]!);
    }
  }
  return target;
}

export function slideMismatchSummary(target: number, observed: number): string {
  return `I asked for slide ${target}, but slide ${observed} is showing. Shall I try again?`;
}
