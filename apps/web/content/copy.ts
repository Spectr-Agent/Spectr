// every visible word on the page lives here, so it can be checked in one place.
// `npm run check:copy` scans this file and fails the build if a rule breaks:
// everything lowercase, no dashes or hyphens, no semicolons, never the words
// actually, genuinely or kind, avoid while, rather than and instead of,
// at most one exclamation point, and short sentences.
// keep links, class names and other non copy out of this file.

import type { ImageKey } from "@/lib/images";
import type { Script } from "@/lib/thread";

type SafetyTile =
  | { title: string; text: string; image: ImageKey; alt: string; zoom?: boolean }
  | { title: string; text: string; placeholder: { lines: string[]; label: string } };

const safetyTiles: SafetyTile[] = [
  { title: "asks before risky actions", text: "sending, buying, submitting and deleting all wait for your yes.", image: "waiting", alt: "spectr mascot waiting for an answer" },
  // OPEN ITEM 1: the passwords tile still needs a mascot pose. the gray box below is a placeholder.
  {
    title: "never types passwords",
    text: "logins stay with you.",
    placeholder: { lines: ["placeholder", "mascot pose needed:", "passwords"], label: "placeholder for a password mascot pose" },
  },
  { title: "say stop anytime", text: "one word ends the task.", image: "stopped", alt: "spectr mascot with a stop sign" },
  { title: "only uses your own mac", text: "spectr works on your computer and nowhere else.", image: "automation", alt: "spectr mascot next to a laptop", zoom: true },
];

interface Stat {
  /** key into lib/sources.ts */
  link: string;
  text: string;
  source: string;
}

export const copy = {
  meta: {
    title: "spectr: your computer, on facetime",
    description: "facetime spectr, say what you need, and watch your mac do the work live on the call.",
  },

  a11y: {
    home: "spectr home",
    menu: "menu",
    previous: "previous",
    next: "next",
    carousel: "use case carousel",
    research: "research carousel",
    logoAlt: "spectr",
    callScreen: "the mac screen, shown on the call",
    slides: "slides",
  },

  nav: {
    links: [
      { href: "#how", label: "how it works" },
      { href: "#cases", label: "use cases" },
      { href: "#safety", label: "safety" },
      { href: "#research", label: "research" },
    ],
  },

  /** one label per slide, for the dots on the side. */
  slides: [
    { id: "top", label: "start" },
    { id: "how", label: "how it works" },
    { id: "cases", label: "use cases" },
    { id: "demo", label: "demo" },
    { id: "safety", label: "safety" },
    { id: "research", label: "research" },
    { id: "more", label: "more research" },
    { id: "closing", label: "end" },
  ],

  /** the facetime call screen on the phone. */
  call: {
    time: "9:41",
    name: "spectr",
    sub: "facetime video",
    you: "you",
    spectr: "spectr",
    desktop: "finder",
  },

  hero: {
    eyebrow: "meet spectr",
    titleLead: "your computer, on ",
    titleHighlight: "facetime.",
    sub: "facetime spectr and say what you need. your mac does the work and you watch its screen on the call.",
    cta: "see how it works",
    note: "say stop to cancel any task.",
    replay: "replay",
    mascotWorking: "spectr mascot working on a task",
    mascotSuccess: "spectr mascot celebrating a finished task",
  },

  how: {
    eyebrow: "how it works",
    title: "four steps. one call.",
    lead: "you talk. your mac works. you watch it happen.",
    steps: [
      { title: "start a facetime call", text: "call spectr like you would call a friend.", image: "welcome", alt: "spectr mascot greeting you" },
      { title: "say what you need", text: "talk in plain words. spectr listens.", image: "listening", alt: "spectr mascot listening" },
      { title: "watch your mac work", text: "your mac screen shows on the call as spectr clicks and types.", image: "screen", alt: "spectr mascot next to a mac screen" },
      { title: "hear the result", text: "spectr tells you what it did. say stop any time.", image: "success", alt: "spectr mascot with a check mark" },
    ] satisfies Array<{ title: string; text: string; image: ImageKey; alt: string }>,
  },

  cases: {
    eyebrow: "use cases",
    title: "calls that sound like you.",
    lead: "swipe through the cards and watch each call play out.",
    cards: [
      { role: "student", title: "brief replies. just the answer.", example: "when is my bio lab due", traits: ["brief", "direct"], image: "launch", alt: "spectr mascot with sparkles" },
      { role: "accessibility", title: "short sentences and a word at each step.", example: "make the text on my screen bigger", traits: ["simple", "step by step", "asks first"], image: "waiting", alt: "spectr mascot waiting for an answer" },
      { role: "corporate", title: "concise and professional.", example: "send the q3 report to my manager", traits: ["concise", "preview first"], image: "success", alt: "spectr mascot with a check mark" },
      { role: "frequent traveler", title: "watch it happen and hear a clear confirmation.", example: "rename the trip photos folder to tokyo 2026", traits: ["live screen", "confirms"], image: "pairing", alt: "spectr mascot between a laptop and a phone" },
    ] satisfies Array<{ role: string; title: string; example: string; traits: string[]; image: ImageKey; alt: string }>,
  },

  demo: {
    eyebrow: "see it connect",
    title: "one call. two screens.",
    lead: "what you see on the call is what happens on your mac.",
    replay: "replay",
    mac: { app: "system settings", pane: "appearance", light: "light", dark: "dark" },
  },

  safety: {
    eyebrow: "safety",
    title: "you stay in control.",
    lead: "spectr checks with you before it takes a big step.",
    tiles: safetyTiles,
  },

  research: {
    eyebrow: "the research",
    title: "the numbers behind it.",
    // the three big numbers
    big: [
      {
        link: "taskflow",
        figure: "over 70%",
        text: "of the phone tasks people put off were ones they planned to finish on a computer.",
        source: "microsoft research, mobile taskflow study, 2010",
      },
      {
        link: "worktrend",
        figure: "2 minutes",
        text: "office workers are interrupted every 2 minutes, about 275 times a day.",
        source: "microsoft work trend index, june 2025",
      },
      {
        link: "babysitting",
        figure: "73 people",
        text: "73 people who use ai agents rated their failures. the most severe ones were the ones they thought they would be least likely to notice.",
        source: "babysitting ai agents, arxiv, october 2026",
      },
    ],
  },

  more: {
    eyebrow: "more research",
    title: "more numbers.",
    facts: [
      { link: "taskflow", text: "people rated finishing a postponed task on a computer as less frustrating than finishing it on the phone.", source: "microsoft research, mobile taskflow study, 2010" },
      { link: "worktrend", text: "the average office worker gets 117 emails a day.", source: "microsoft work trend index, june 2025" },
      { link: "atlassian", text: "knowledge workers spend about 25% of their week searching for information.", source: "atlassian state of teams, 2025" },
      { link: "perk", text: "89% of business travelers had a trip disrupted in 2025. each disrupted trip cost them almost 5 hours.", source: "perk, september 2025" },
      { link: "students", text: "85% of college students used ai for coursework in the past year.", source: "inside higher ed student voice, 2025" },
      { link: "piper", text: "87% of us teens own an iphone.", source: "piper sandler, fall 2025" },
      { link: "pew", text: "90% of adults 65 and older use the internet.", source: "pew research, 2025" },
      { link: "aarp2024", text: "71% of adults 50 and older prefer a friend or family member to teach them new tech.", source: "aarp tech trends, 2024" },
      { link: "aarp2026", text: "3 in 5 adults 50 and older say tech is designed without their age in mind.", source: "aarp tech trends, 2026" },
      { link: "ftc", text: "people 60 and older reported $2.4 billion in fraud losses in 2024, including $159 million to tech support scams.", source: "ftc, december 2025" },
      { link: "w3c", text: "w3c accessibility guidance calls for clear words, short text and step by step instructions, plus a way to confirm or undo important actions.", source: "w3c coga and wcag 3.3.4" },
    ] satisfies Stat[],
  },

  /** what the mac screen shows in the call video. */
  scenes: {
    resume: { title: "documents", sidebar: ["desktop", "documents", "downloads"], rows: ["cover_letter.docx", "resume_2026.pdf", "notes.txt"], selected: 1 },
    due: { title: "assignments", sidebar: ["courses", "assignments", "grades"], rows: ["chem quiz, monday", "bio lab, friday 11:59 pm", "essay draft, next week"], selected: 1 },
    folder: { title: "trips", folders: ["receipts", "tokyo 2026", "tickets"] },
    text: { title: "display", sample: "aa", label: "text size" },
    mail: { title: "mail", to: "to: dana ruiz", subject: "subject: q3 report", body: "hi dana, the q3 report is attached. thanks.", file: "q3_report_final.pdf" },
  },

  closing: {
    title: "say hi to spectr.",
    lead: "facetime it. say what you need. watch your mac do it.",
    mascotAlt: "spectr mascot greeting you",
    textLine: "prefer to text? that works too.",
    me: "find my resume",
    bot: "here it is. resume_2026.pdf is open on your mac.",
  },

  footer: {
    builtBy: "built by",
    team: ["sweeya", "jared", "poorav", "colby"],
    github: "github",
    tagline: "your computer, on facetime.",
    year: "2026 spectr",
  },
};

// OPEN ITEM 3: the names, times and files in the example calls below are made up.

export const heroScript: Script = [
  { from: "me", text: "find my resume", pre: 900 },
  { from: "bot", text: "on it.", typing: 1000 },
  { from: "bot", text: "found it. resume_2026.pdf is open.", typing: 1300, scene: "resume", pose: "success" },
];

export const caseScripts: readonly Script[] = [
  [
    { from: "me", text: "when is my bio lab due" },
    { from: "bot", text: "let me check.", typing: 700 },
    { from: "bot", text: "friday at 11:59 pm.", typing: 900, scene: "due" },
  ],
  [
    { from: "me", text: "make the text on my screen bigger" },
    { from: "bot", text: "okay. i can do that.", typing: 800 },
    { from: "bot", text: "step 1 of 2. opening settings.", typing: 900 },
    { from: "bot", text: "quick question. bigger for everything or only the text? say one for everything. say two for only the text.", typing: 1100 },
    { from: "me", text: "one" },
    { from: "bot", text: "step 2 of 2. making everything bigger.", typing: 900, scene: "text" },
    { from: "bot", text: "done. is this easy to read? say bigger if you want more.", typing: 800 },
  ],
  [
    { from: "me", text: "send the q3 report to my manager" },
    { from: "bot", text: "found q3_report_final.pdf. here is the draft.", typing: 900, scene: "mail" },
    { from: "bot", text: "send it? say yes or tell me what to change.", typing: 800 },
    { from: "me", text: "yes" },
    { from: "bot", text: "sent at 9:42 am.", typing: 700 },
  ],
  [
    { from: "me", text: "rename the trip photos folder to tokyo 2026" },
    { from: "bot", text: "on it.", typing: 700 },
    { from: "bot", text: "done. the folder is now tokyo 2026.", typing: 1000, scene: "folder" },
    { from: "bot", text: "say the word if you want a different name.", typing: 900 },
  ],
];

export const demoScript: Script = [
  { from: "me", text: "turn on dark mode" },
  { from: "bot", text: "on it.", typing: 800 },
  { action: "mac" },
  { from: "bot", text: "dark mode is on.", typing: 700 },
];
