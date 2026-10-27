// lib/og/card.tsx - The branded 1200x630 share card, rendered with next/og.
// Barlow Condensed for the words; Inter (latin-ext) as a fallback for ₹,
// which Barlow lacks. Satori needs display:flex on any multi-child div.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

// Hex copies of the dark floodlight tokens (Satori can't read CSS variables).
const C = { canvas: "#070b14", surface: "#0e1524", ink: "#f2f5fa", muted: "#9aa6bc", signal: "#22d3ee", sold: "#34d399" };

async function fonts() {
  const dir = join(process.cwd(), "lib/og/fonts");
  const [barlow, inter] = await Promise.all([
    readFile(join(dir, "BarlowCondensed-Bold.ttf")),
    readFile(join(dir, "inter-latin-ext-700-normal.woff")),
  ]);
  return [
    { name: "Barlow Condensed", data: barlow, weight: 700 as const, style: "normal" as const },
    { name: "Inter", data: inter, weight: 700 as const, style: "normal" as const },
  ];
}

export async function ogCard({
  eyebrow,
  title,
  detail,
  price,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  /** Shown big in the SOLD colour, e.g. "₹24.00L". */
  price?: string;
}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: C.canvas,
          backgroundImage: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(34,211,238,0.25), transparent)",
          color: C.ink,
          fontFamily: "Barlow Condensed, Inter",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 44, letterSpacing: 2 }}>
          <div style={{ width: 44, height: 44, borderRadius: 22, background: "#d22f2f", display: "flex" }} />
          <div style={{ display: "flex" }}>
            BID<span style={{ color: C.signal }}>11</span>PRO
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 32, color: C.signal, letterSpacing: 4, textTransform: "uppercase" }}>
            {eyebrow}
          </div>
          <div style={{ display: "flex", fontSize: 92, lineHeight: 0.95, textTransform: "uppercase", maxWidth: 1056 }}>
            {title}
          </div>
          {detail && <div style={{ display: "flex", fontSize: 40, color: C.muted }}>{detail}</div>}
        </div>
        {price ? (
          <div style={{ display: "flex", fontSize: 120, lineHeight: 1, color: C.sold }}>{price}</div>
        ) : (
          <div style={{ display: "flex", height: 8, width: 240, background: C.signal, borderRadius: 4 }} />
        )}
      </div>
    ),
    { ...OG_SIZE, fonts: await fonts() },
  );
}
