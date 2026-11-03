// lib/design/tokens.ts - Token metadata for the /design page: what each role
// is for and which pairs are checked. The values themselves live only in
// app/globals.css (lib/design/contrast.test.ts reads them from there).

export const COLOR_ROLES: { role: string; use: string }[] = [
  { role: "canvas", use: "Page background" },
  { role: "surface", use: "Cards, panels" },
  { role: "raised", use: "Popovers, hovered rows" },
  { role: "ink", use: "Primary text" },
  { role: "ink-muted", use: "Secondary text" },
  { role: "line", use: "Dividers (decorative)" },
  { role: "line-strong", use: "Input borders (3:1)" },
  { role: "signal", use: "The accent: primary action, live" },
  { role: "signal-ink", use: "Text on the accent" },
  { role: "sold", use: "SOLD" },
  { role: "unsold", use: "UNSOLD, errors" },
  { role: "timer", use: "Timer, warnings" },
  { role: "focus", use: "Keyboard focus ring" },
];

export const MOTION = [
  { name: "--dur-fast", ms: 150, use: "Hover, press, colour changes" },
  { name: "--dur-base", ms: 200, use: "Small enter/exit" },
  { name: "--dur-slow", ms: 250, use: "Dialogs, sheets, price roll" },
  { name: "--dur-moment", ms: 750, use: "SOLD stamp, new-player reveal" },
];
