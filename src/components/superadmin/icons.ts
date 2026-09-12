export type IconName =
  | "home"
  | "building"
  | "user"
  | "idCard"
  | "shield"
  | "package"
  | "graduationCap"
  | "megaphone"
  | "fileText"
  | "wrench"
  | "lifeBuoy"
  | "trendingUp"
  | "users"
  | "settings"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "theme"
  | "logout"
  | "plus";

export type IconSpec = {
  paths?: string[];
  circles?: { cx: number; cy: number; r: number }[];
  rects?: { x: number; y: number; width: number; height: number; rx?: number }[];
};

export const ICONS: Record<IconName, IconSpec> = {
  home: { paths: ["M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5H9v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"] },
  building: {
    paths: [
      "M6 22V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v18",
      "M2 22h20",
      "M9 6h1M9 10h1M9 14h1M14 6h1M14 10h1M14 14h1",
    ],
  },
  user: {
    paths: ["M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"],
    circles: [{ cx: 12, cy: 8, r: 4 }],
  },
  idCard: {
    paths: ["M2 10h20"],
    rects: [{ x: 2, y: 5, width: 20, height: 14, rx: 2 }],
  },
  shield: { paths: ["M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"] },
  package: {
    paths: ["M21 8 12 3 3 8l9 5 9-5Z", "M3 8v9l9 5 9-5V8", "M12 13v9"],
  },
  graduationCap: {
    paths: ["M22 10 12 5 2 10l10 5 10-5Z", "M6 12.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"],
  },
  megaphone: {
    paths: [
      "M3 11v3a1 1 0 0 0 1 1h2l4 4v-13l-4 4H4a1 1 0 0 0-1 1Z",
      "M15 8a4 4 0 0 1 0 8",
      "M18 5a8 8 0 0 1 0 14",
    ],
  },
  fileText: {
    paths: [
      "M14 3v4a1 1 0 0 0 1 1h4",
      "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z",
      "M9 13h6M9 17h6",
    ],
  },
  wrench: { paths: ["M14.7 6.3a4 4 0 1 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2Z"] },
  lifeBuoy: {
    paths: ["m8.5 8.5-3-3M15.5 8.5l3-3M15.5 15.5l3 3M8.5 15.5l-3 3"],
    circles: [
      { cx: 12, cy: 12, r: 9 },
      { cx: 12, cy: 12, r: 4 },
    ],
  },
  trendingUp: { paths: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"] },
  users: {
    paths: ["M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2", "M23 21v-1.5a4 4 0 0 0-3-3.9"],
    circles: [
      { cx: 9, cy: 7, r: 4 },
      { cx: 17, cy: 7, r: 3 },
    ],
  },
  settings: {
    paths: [
      "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z",
    ],
    circles: [{ cx: 12, cy: 12, r: 3 }],
  },
  chevronLeft: { paths: ["M15 18l-6-6 6-6"] },
  chevronRight: { paths: ["M9 18l6-6-6-6"] },
  chevronDown: { paths: ["M6 9l6 6 6-6"] },
  theme: {
    paths: [
      "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    ],
    circles: [{ cx: 12, cy: 12, r: 4 }],
  },
  logout: { paths: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"] },
  plus: { paths: ["M12 5v14M5 12h14"] },
};
