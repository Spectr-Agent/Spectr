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
  { title: "Say stop anytime", text: "One word ends the task.", image: "stopped", alt: "Spectr mascot with a stop sign" },
  { title: "Only uses your own Mac", text: "Spectr works on your computer and nowhere else.", image: "automation", alt: "Spectr mascot next to a laptop", zoom: true },
];

export const copy = {
  meta: {
    title: "Spectr: your computer, on FaceTime",
    description: "FaceTime Spectr, say what you need, and watch your Mac do the work live on the call.",
  },

  a11y: {
    home: "Spectr home",
    menu: "Menu",
    previous: "Previous",
    next: "Next",
    carousel: "Use case carousel",
    email: "Email address",
    logoAlt: "Spectr",
    callScreen: "The Mac screen, shown on the call",
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

  /** The FaceTime call screen on the phone. */
  call: {
    time: "9:41",
    name: "Spectr",
    sub: "FaceTime Video",
    you: "You",
    spectr: "Spectr",
    desktop: "Finder",
  },

  hero: {
    eyebrow: "Early access waitlist",
    titleLead: "your computer, on ",
    titleHighlight: "FaceTime.",
    sub: "FaceTime Spectr and say what you need. Your Mac does the work and you watch its screen on the call.",
    cta: "Join the waitlist",
    note: "Say stop to cancel any task.",
    replay: "Replay",
    mascotWorking: "Spectr mascot working on a task",
    mascotSuccess: "Spectr mascot celebrating a finished task",
  },

  how: {
    eyebrow: "How it works",
    title: "Four steps. One call.",
    lead: "You talk. Your Mac works. You watch it happen.",
    steps: [
      { title: "Start a FaceTime call", text: "Call Spectr like you would call a friend.", image: "welcome", alt: "Spectr mascot greeting you" },
      { title: "Say what you need", text: "Talk in plain words. Spectr listens.", image: "listening", alt: "Spectr mascot listening" },
      { title: "Watch your Mac work", text: "Your Mac screen shows on the call as Spectr clicks and types.", image: "screen", alt: "Spectr mascot next to a Mac screen" },
      { title: "Hear the result", text: "Spectr tells you what it did. Say stop any time.", image: "success", alt: "Spectr mascot with a check mark" },
    ] satisfies Array<{ title: string; text: string; image: ImageKey; alt: string }>,
  },

  cases: {
    eyebrow: "Use cases",
    title: "Calls that sound like you.",
    lead: "Swipe through the cards and watch each call play out.",
    cards: [
      { role: "Student", title: "Brief replies. Just the answer.", example: "when is my bio lab due", traits: ["Brief", "Direct"], image: "launch", alt: "Spectr mascot with sparkles" },
      { role: "Accessibility", title: "Short sentences and a word at each step.", example: "make the text on my screen bigger", traits: ["Simple", "Step by step", "Asks first"], image: "waiting", alt: "Spectr mascot waiting for an answer" },
      { role: "Corporate", title: "Concise and professional.", example: "send the Q3 report to my manager", traits: ["Concise", "Preview first"], image: "success", alt: "Spectr mascot with a check mark" },
      { role: "Frequent traveler", title: "Watch it happen and hear a clear confirmation.", example: "rename the trip photos folder to Tokyo 2026", traits: ["Live screen", "Confirms"], image: "pairing", alt: "Spectr mascot between a laptop and a phone" },
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
    title: "One call. Two screens.",
    lead: "What you see on the call is what happens on your Mac.",
    replay: "Replay",
    mac: { app: "System Settings", pane: "Appearance", light: "Light", dark: "Dark" },
  },

  /** What the Mac screen shows in the call video. */
  scenes: {
    resume: { title: "Documents", sidebar: ["Desktop", "Documents", "Downloads"], rows: ["Cover_letter.docx", "Resume_2026.pdf", "Notes.txt"], selected: 1 },
    due: { title: "Assignments", sidebar: ["Courses", "Assignments", "Grades"], rows: ["Chem quiz, Monday", "Bio lab, Friday 11:59 PM", "Essay draft, next week"], selected: 1 },
    folder: { title: "Trips", folders: ["Receipts", "Tokyo 2026", "Tickets"] },
    text: { title: "Display", sample: "Aa", label: "Text size" },
    mail: { title: "Mail", to: "To: Dana Ruiz", subject: "Subject: Q3 report", body: "Hi Dana, the Q3 report is attached. Thanks.", file: "Q3_Report_Final.pdf" },
  },

  /** The small "text works too" band. Text is a side option, not the main way in. */
  textToo: {
    eyebrow: "Prefer to text?",
    title: "Text works too.",
    lead: "Cannot talk right now? Send Spectr a message. It does the same work and replies in the thread.",
    me: "find my resume",
    bot: "Here it is. Resume_2026.pdf is open on your Mac.",
  },

  faq: {
    eyebrow: "FAQ",
    title: "Good questions.",
    items: [
      { q: "What is Spectr?", a: "Spectr is a personal computer agent you reach on FaceTime. You call it and say what you need. Your Mac does the work and you watch its screen on the call." },
      { q: "What can I ask it to do?", a: "Everyday computer tasks such as finding a file, renaming a folder or checking a due date. Spectr works step by step and tells you what it did." },
      { q: "Does it ask before big actions?", a: "Yes. Spectr asks before it sends anything. It asks before it buys anything. It asks before it submits a form or deletes a file. Nothing goes ahead until you say yes." },
      { q: "Does it ever type my passwords?", a: "No. Spectr never types passwords. If a task needs a login, you handle that step yourself." },
      { q: "How do I stop a task?", a: "Say stop and the task is cancelled. You can also change your mind out loud and Spectr adjusts its next step." },
      { q: "Do I have to talk?", a: "No. You can text Spectr too. It does the same work and replies in the thread." },
      // OPEN ITEM 2: pricing and the launch date are not decided. This answer is placeholder copy.
      { q: "When can I try it and what will it cost?", a: "Spectr is in early access. Join the waitlist and we will email you when your spot opens. Pricing and launch date to come.", placeholderTag: "Placeholder copy" },
    ],
  },

  cta: {
    title: "Ready to FaceTime your computer?",
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
    tagline: "your computer, on FaceTime.",
    year: "2026 Spectr",
  },
};

// OPEN ITEM 3: the names, times and files in the example calls below are made up.

export const heroScript: Script = [
  { from: "me", text: "find my resume", pre: 900 },
  { from: "bot", text: "On it.", typing: 1000 },
  { from: "bot", text: "Found it. Resume_2026.pdf is open.", typing: 1300, scene: "resume", pose: "success" },
];

export const caseScripts: readonly Script[] = [
  [
    { from: "me", text: "when is my bio lab due" },
    { from: "bot", text: "Let me check.", typing: 700 },
    { from: "bot", text: "Friday at 11:59 PM.", typing: 900, scene: "due" },
  ],
  [
    { from: "me", text: "make the text on my screen bigger" },
    { from: "bot", text: "Okay. I can do that.", typing: 800 },
    { from: "bot", text: "Step 1 of 2. Opening Settings.", typing: 900 },
    { from: "bot", text: "Quick question. Bigger for everything or only the text? Say one for everything. Say two for only the text.", typing: 1100 },
    { from: "me", text: "one" },
    { from: "bot", text: "Step 2 of 2. Making everything bigger.", typing: 900, scene: "text" },
    { from: "bot", text: "Done. Is this easy to read? Say bigger if you want more.", typing: 800 },
  ],
  [
    { from: "me", text: "send the Q3 report to my manager" },
    { from: "bot", text: "Found Q3_Report_Final.pdf. Here is the draft.", typing: 900, scene: "mail" },
    { from: "bot", text: "Send it? Say yes or tell me what to change.", typing: 800 },
    { from: "me", text: "yes" },
    { from: "bot", text: "Sent at 9:42 AM.", typing: 700 },
  ],
  [
    { from: "me", text: "rename the trip photos folder to Tokyo 2026" },
    { from: "bot", text: "On it.", typing: 700 },
    { from: "bot", text: "Done. The folder is now Tokyo 2026.", typing: 1000, scene: "folder" },
    { from: "bot", text: "Say the word if you want a different name.", typing: 900 },
  ],
];

export const demoScript: Script = [
  { from: "me", text: "turn on dark mode" },
  { from: "bot", text: "On it.", typing: 800 },
  { action: "mac" },
  { from: "bot", text: "Dark mode is on.", typing: 700 },
];
