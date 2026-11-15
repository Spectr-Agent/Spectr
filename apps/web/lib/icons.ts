// Flat line icons, drawn on a 24 by 24 grid with square ends and sharp corners.
// Each value is the path data for one icon. Add a name here to add an icon.

export const ICONS = {
  facetime: "M3 6h12v12H3z M15 10l6-3v10l-6-3",
  phone: "M8 2h8v20H8z M11 19h2",
  mic: "M9 2h6v12H9z M5 10v4h14v-4 M12 18v4 M8 22h8",
  screen: "M3 4h18v12H3z M8 20h8 M12 16v4",
  cursor: "M5 3l14 8-6 2-2 6z",
  keyboard: "M3 6h18v12H3z M7 10h2 M11 10h2 M15 10h2 M7 14h10",
  stop: "M7 3h10l4 4v10l-4 4H7l-4-4V7z M8 12h8",
  lock: "M5 10h14v11H5z M8 10V6h8v4 M12 14v3",
  shield: "M12 2l8 3v7c0 5-4 9-8 10-4-1-8-5-8-10V5z M8 12l3 3 5-6",
  check: "M4 12l5 5 11-11",
  file: "M6 2h8l4 4v16H6z M14 2v4h4",
  folder: "M3 5h7l2 3h9v12H3z",
  mail: "M3 5h18v14H3z M3 5l9 8 9-8",
  calendar: "M3 5h18v16H3z M3 10h18 M8 2v5 M16 2v5",
  clock: "M3 3h18v18H3z M12 7v5l4 2",
  search: "M4 4h12v12H4z M16 16l5 5",
  send: "M4 20L20 4 M8 4h12v12",
  trash: "M4 6h16 M9 6V3h6v3 M6 6v15h12V6 M10 10v7 M14 10v7",
  eye: "M2 12l5-6h10l5 6-5 6H7z M10 10h4v4h-4z",
  arrow: "M4 12h16 M14 6l6 6-6 6",
  person: "M8 3h8v8H8z M4 21v-5h16v5",
  chart: "M3 20V4 M3 20h18 M7 16l4-5 4 3 5-8",
} as const;

export type IconName = keyof typeof ICONS;
