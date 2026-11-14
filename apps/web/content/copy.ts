// Every visible word on the page lives here, so it can be checked in one place.
// `npm run check:copy` scans this file and fails the build if a rule breaks:
// no dashes or hyphens, no semicolons, never the words actually, genuinely or kind,
// avoid while, rather than and instead of, at most one exclamation point,
// and short sentences. Keep links, class names and other non copy out of this file.

import type { ImageKey } from "@/lib/images";
import type { Script } from "@/lib/thread";

type SafetyTile =
  | { title: string; text: string; image: ImageKey; alt: string; zoom?: boolean }
  | { title: string; text: string; placeholder: { lines: string[]; label: string } };

const safetyTiles: SafetyTile[] = [
  { title: "Asks before risky actions", text: "Sending, buying, submitting and deleting all wait for your yes.", image: "waiting", alt: "Spectr mascot waiting for an answer" },
  // OPEN ITEM 1: the passwords tile still needs a mascot pose. The gray box below is a placeholder.
  {
    title: "Never types passwords",
    text: "Logins stay with you.",
    placeholder: { lines: ["Placeholder", "Mascot pose needed:", "passwords"], label: "Placeholder for a password mascot pose" },
  },
  { title: "Text stop anytime", text: "One word ends the task.", image: "stopped", alt: "Spectr mascot with a stop sign" },
  { title: "Only uses your own Mac", text: "Spectr works on your computer and nowhere else.", image: "automation", alt: "Spectr mascot next to a laptop", zoom: true },
];

export const copy = {
  meta: {
    title: "Spectr: your computer, by text",
    description: "Text a task to Spectr. Your Mac does the work step by step and the result comes back in the same thread.",
  },

  a11y: {
    home: "Spectr home",
    menu: "Menu",
    previous: "Previous",
    next: "Next",
    carousel: "Use case carousel",
    email: "Email address",
    logoAlt: "Spectr",
  },

  nav: {
    links: [
      { href: "#how", label: "How it works" },
      { href: "#cases", label: "Use cases" },
      { href: "#safety", label: "Safety" },
      { href: "#faq", label: "FAQ" },
    ],
    cta: "Join the waitlist",
  },

  phone: {
    time: "9:41",
    stamp: "Today 9:41 AM",
    name: "Spectr",
    previewTo: "To:",
    previewSubject: "Subject:",
    pdf: "PDF",
  },

  hero: {
    eyebrow: "Early access waitlist",
    titleLead: "your computer, ",
    titleHighlight: "by text.",
    sub: "Text a task to Spectr. Your Mac does the work step by step and the result comes back in the same thread.",
    cta: "Join the waitlist",
    note: "Text stop to cancel any task.",
    replay: "Replay",
    mascotWorking: "Spectr mascot working on a task",
    mascotSuccess: "Spectr mascot celebrating a finished task",
  },

  how: {
    eyebrow: "How it works",
    title: "Four steps. One thread.",
    lead: "You text. Your Mac works. The result comes back to you.",
    steps: [
      { title: "Text a task", text: "Send Spectr a message like you would send a friend.", image: "listening", alt: "Spectr mascot listening for a text" },
      { title: "Spectr looks at your Mac", text: "It checks what is on your screen.", image: "screen", alt: "Spectr mascot next to a Mac screen" },
      { title: "Your Mac does the work", text: "Clicks and typing happen one step at a time.", image: "working", alt: "Spectr mascot working with gears" },
      { title: "You get the result", text: "An answer or a screenshot lands in the thread.", image: "success", alt: "Spectr mascot with a check mark" },
    ] satisfies Array<{ title: string; text: string; image: ImageKey; alt: string }>,
  },

  cases: {
    eyebrow: "Use cases",
    title: "Texts that sound like you.",
    lead: "Swipe through the cards and watch each thread type out.",
    cards: [
      { role: "Student", title: "Brief replies. Just the answer.", example: "when is my bio lab due", traits: ["Brief", "Direct"], image: "launch", alt: "Spectr mascot with sparkles" },
      { role: "Accessibility", title: "Short sentences and a text at each step.", example: "make the text on my screen bigger", traits: ["Simple", "Step by step", "Asks first"], image: "waiting", alt: "Spectr mascot waiting for an answer" },
      { role: "Corporate", title: "Concise and professional.", example: "send the Q3 report to my manager", traits: ["Concise", "Preview first"], image: "success", alt: "Spectr mascot with a check mark" },
      { role: "Frequent traveler", title: "A screenshot and a clear confirmation.", example: "rename the trip photos folder to Tokyo 2026", traits: ["Screenshot", "Confirms"], image: "pairing", alt: "Spectr mascot between a laptop and a phone" },
    ] satisfies Array<{ role: string; title: string; example: string; traits: string[]; image: ImageKey; alt: string }>,
  },

  safety: {
    eyebrow: "Safety",
    title: "You stay in control.",
    lead: "Spectr checks with you before it takes a big step.",
    tiles: safetyTiles,
  },

  demo: {
    eyebrow: "See it connect",
    title: "One text. Two screens.",
    lead: "What lands on your phone is what happened on your Mac.",
    replay: "Replay",
    mac: { app: "System Settings", pane: "Appearance", light: "Light", dark: "Dark" },
  },

  shots: {
    resume: { title: "Documents", sidebar: ["Desktop", "Documents", "Downloads"], files: ["Cover_letter.docx", "Resume_2026.pdf", "Notes.txt"] },
    folder: { title: "Trips", folders: ["Receipts", "Tokyo 2026", "Tickets"] },
    text: { title: "Display", sample: "Aa", label: "Text size" },
  },

  faq: {
    eyebrow: "FAQ",
    title: "Good questions.",
    items: [
      { q: "What is Spectr?", a: "Spectr is a personal computer agent you reach by text. You message its iMessage number with a task. Your Mac does the work and the result comes back in the same thread." },
      { q: "What can I ask it to do?", a: "Everyday computer tasks such as finding a file, renaming a folder or checking a due date. Spectr works step by step and tells you what it did." },
      { q: "Does it ask before big actions?", a: "Yes. Spectr asks before it sends anything. It asks before it buys anything. It asks before it submits a form or deletes a file. Nothing goes ahead until you reply yes." },
      { q: "Does it ever type my passwords?", a: "No. Spectr never types passwords. If a task needs a login, you handle that step yourself." },
      { q: "How do I stop a task?", a: "Text stop and the task is cancelled. You can also text a correction and Spectr adjusts its next step." },
      // OPEN ITEM 2: pricing and the launch date are not decided. This answer is placeholder copy.
      { q: "When can I try it and what will it cost?", a: "Spectr is in early access. Join the waitlist and we will email you when your spot opens. Pricing and launch date to come.", placeholderTag: "Placeholder copy" },
    ],
  },

  cta: {
    title: "Ready to text your computer?",
    lead: "Join the waitlist and be first in line to try Spectr.",
    emailPlaceholder: "you@email.com",
    button: "Join the waitlist",
    sending: "Joining",
    success: "You are on the list!",
    invalid: "Please enter a valid email.",
    tooMany: "Too many tries. Please wait a few minutes.",
    failed: "Something went wrong. Please try again.",
    mascotAlt: "Spectr mascot greeting you",
  },

  footer: {
    builtBy: "Built by",
    team: ["Sweeya", "Jared", "Poorav", "Colby"],
    github: "GitHub",
    tagline: "your computer, by text.",
    year: "2026 Spectr",
  },
};

// OPEN ITEM 3: the names, times and files in the example threads below are made up.

export const heroScript: Script = [
  { from: "me", text: "find my resume and send it to me", pre: 900 },
  { from: "bot", text: "On it.", typing: 1000 },
  { from: "bot", file: "Resume_2026.pdf", size: "PDF, 112 KB", typing: 1500 },
  { from: "bot", shot: "resume", typing: 900, pose: "success" },
];

export const caseScripts: readonly Script[] = [
  [
    { from: "me", text: "when is my bio lab due" },
    { from: "bot", text: "Friday at 11:59 PM.", typing: 700 },
  ],
  [
    { from: "me", text: "make the text on my screen bigger" },
    { from: "bot", text: "Okay. I can do that.", typing: 800 },
    { from: "bot", text: "Step 1 of 2. Opening Settings.", typing: 900 },
    { from: "bot", text: "Quick question. Bigger for everything or only the text? Reply 1 for everything. Reply 2 for only the text.", typing: 1100 },
    { from: "me", text: "1" },
    { from: "bot", text: "Step 2 of 2. Making everything bigger.", typing: 900 },
    { from: "bot", shot: "text", typing: 900 },
    { from: "bot", text: "Done. Is this easy to read? Reply bigger if you want more.", typing: 800 },
  ],
  [
    { from: "me", text: "send the Q3 report to my manager" },
    { from: "bot", text: "Found Q3_Report_Final.pdf. Here is the draft.", typing: 900 },
    { from: "bot", preview: { to: "Dana Ruiz", subject: "Q3 report", body: "Hi Dana, the Q3 report is attached. Thanks.", file: "Q3_Report_Final.pdf" }, typing: 900 },
    { from: "bot", text: "Send it? Reply yes or tell me what to change.", typing: 800 },
    { from: "me", text: "yes" },
    { from: "bot", text: "Sent at 9:42 AM.", typing: 700 },
  ],
  [
    { from: "me", text: "rename the trip photos folder to Tokyo 2026" },
    { from: "bot", text: "On it.", typing: 700 },
    { from: "bot", shot: "folder", typing: 1000 },
    { from: "bot", text: "Done. The folder is now Tokyo 2026. Text me if you want a different name.", typing: 900 },
  ],
];

export const demoScript: Script = [
  { from: "me", text: "turn on dark mode" },
  { from: "bot", text: "On it.", typing: 800 },
  { action: "mac" },
  { from: "bot", shot: "dark", typing: 900 },
  { from: "bot", text: "Dark mode is on.", typing: 700 },
];
