import type { jsPDF } from "jspdf";
import { loadPdfImage, mapWithConcurrency, pdfImageFormat } from "@/lib/pdfImages";

/**
 * Organisation logo and sponsors (set on the registration form) for the
 * player and team PDFs. Logos are loaded as PNG so transparent ones stay clean.
 */

export interface PdfBranding {
  organizationLogo: string | null;
  sponsors: Array<{ name: string; logo: string | null }>;
}

export async function loadPdfBranding(source: {
  organizationLogoUrl?: string;
  sponsors?: Array<{ name: string; logoUrl?: string }>;
}): Promise<PdfBranding> {
  const logo = (url?: string) => (url ? loadPdfImage(url, { format: "png", width: 400 }) : Promise.resolve(null));
  const [organizationLogo, sponsors] = await Promise.all([
    logo(source.organizationLogoUrl),
    mapWithConcurrency(source.sponsors ?? [], 4, async (s) => ({ name: s.name, logo: await logo(s.logoUrl) })),
  ]);
  return { organizationLogo, sponsors };
}

/** Largest w×h with the image's aspect ratio that fits the box, centred in it. */
export function fitContain(imgW: number, imgH: number, boxW: number, boxH: number) {
  if (!(imgW > 0) || !(imgH > 0)) return { w: boxW, h: boxH, dx: 0, dy: 0 };
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { w, h, dx: (boxW - w) / 2, dy: (boxH - h) / 2 };
}

/** Draws an image contained (never stretched) in the box. False if jsPDF can't use it. */
export function drawContainedImage(pdf: jsPDF, dataUrl: string, x: number, y: number, boxW: number, boxH: number): boolean {
  try {
    const props = pdf.getImageProperties(dataUrl);
    const fit = fitContain(props.width, props.height, boxW, boxH);
    pdf.addImage(dataUrl, pdfImageFormat(dataUrl) ?? "PNG", x + fit.dx, y + fit.dy, fit.w, fit.h);
    return true;
  } catch {
    return false;
  }
}

export interface SponsorGridLayout {
  tileW: number;
  tileH: number;
  gap: number;
}

const TITLE_H = 7;
const CAPTION_H = 4.5;

/** Columns that fit in `width`, at least 1. */
export function sponsorColumns(width: number, { tileW, gap }: SponsorGridLayout): number {
  return Math.max(1, Math.floor((width + gap) / (tileW + gap)));
}

/** Height the grid will take (title included), 0 with no sponsors. */
export function sponsorGridHeight(count: number, width: number, layout: SponsorGridLayout): number {
  if (count === 0) return 0;
  const rows = Math.ceil(count / sponsorColumns(width, layout));
  return TITLE_H + rows * (layout.tileH + CAPTION_H) + (rows - 1) * layout.gap;
}

/**
 * "SUPPORTED BY" and a centred grid of white tiles, logo contained in each,
 * sponsor name below. A sponsor without a usable logo shows its name in the tile.
 * Returns the height used.
 */
export function drawSponsorGrid(
  pdf: jsPDF,
  sponsors: PdfBranding["sponsors"],
  x: number,
  y: number,
  width: number,
  layout: SponsorGridLayout,
  theme: "light" | "dark",
): number {
  if (sponsors.length === 0) return 0;
  const { tileW, tileH, gap } = layout;
  const cols = sponsorColumns(width, layout);
  const caption: [number, number, number] = theme === "dark" ? [203, 213, 225] : [71, 85, 105];

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(caption[0], caption[1], caption[2]);
  pdf.text("SUPPORTED BY", x + width / 2, y + 4, { align: "center" });

  sponsors.forEach((sponsor, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, sponsors.length - row * cols);
    const rowWidth = inRow * tileW + (inRow - 1) * gap;
    const tx = x + (width - rowWidth) / 2 + col * (tileW + gap);
    const ty = y + TITLE_H + row * (tileH + CAPTION_H + gap);

    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.roundedRect(tx, ty, tileW, tileH, 1.5, 1.5, "FD");

    const pad = 2;
    const drawn = sponsor.logo && drawContainedImage(pdf, sponsor.logo, tx + pad, ty + pad, tileW - 2 * pad, tileH - 2 * pad);
    if (!drawn) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(71, 85, 105);
      const lines = pdf.splitTextToSize(sponsor.name, tileW - 2 * pad).slice(0, 2);
      pdf.text(lines, tx + tileW / 2, ty + tileH / 2 + (lines.length === 1 ? 1 : -0.5), { align: "center" });
    }

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.5);
    pdf.setTextColor(caption[0], caption[1], caption[2]);
    const name = pdf.splitTextToSize(sponsor.name, tileW)[0] ?? "";
    pdf.text(name, tx + tileW / 2, ty + tileH + 3.3, { align: "center" });
  });

  return sponsorGridHeight(sponsors.length, width, layout);
}
