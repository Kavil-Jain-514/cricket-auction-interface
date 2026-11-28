import { jsPDF } from "jspdf";
import { formatCurrencyFull } from "@/lib/utils";
import type { PdfPlayer } from "@/lib/teamPdfPlayers";
import { loadPdfImage, pdfImageFormat } from "@/lib/pdfImages";
import { drawContainedImage, drawSponsorGrid, loadPdfBranding, sponsorGridHeight } from "@/lib/pdfBranding";

interface TeamData {
  name: string;
  ownerName: string;
  sponsorName?: string;
  colorPrimary: string;
  colorSecondary: string;
  purseRemaining: number;
  purseSpent: number;
  players: PdfPlayer[];
  tournamentName?: string;
  logoUrl?: string;
  groupLabel?: string; // e.g. "Group A (A1)" — only set once the draw is locked
  // From the registration form: organisation logo in the header, sponsors under the squad.
  organizationLogoUrl?: string;
  sponsors?: Array<{ name: string; logoUrl?: string }>;
  // Couple tournament: Gender and Rank columns replace Jersey Name,
  // and each couple's female member gets a line under the row.
  couple?: boolean;
}

const SPONSOR_LAYOUT = { tileW: 30, tileH: 18, gap: 4 };


function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 59, g: 130, b: 246 }; // default blue
}

// Squad table column x-offsets from the left margin (header and rows share these).
const COL = {
  index: 2,
  name: 8,
  age: 48,
  phone: 58,
  jerseyNumber: 82,
  jerseyName: 96,
  gender: 96, // couple tournaments: Gender and Rank share the Jersey Name space
  rank: 114,
  size: 126,
  hand: 139,
  price: 152,
} as const;

// Squad table column labels, vertically centred in the 8-tall header band at `y`.
function drawTableHeader(doc: jsPDF, margin: number, y: number, couple = false): void {
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  const textY = y + 5.3;
  doc.text("#", margin + COL.index, textY);
  doc.text("Player Name", margin + COL.name, textY);
  doc.text("Age", margin + COL.age, textY);
  doc.text("Phone", margin + COL.phone, textY);
  doc.text("Jersey#", margin + COL.jerseyNumber, textY);
  if (couple) {
    doc.text("Gender", margin + COL.gender, textY);
    doc.text("Rank", margin + COL.rank, textY);
  } else {
    doc.text("Jersey Name", margin + COL.jerseyName, textY);
  }
  doc.text("Size", margin + COL.size, textY);
  doc.text("Hand", margin + COL.hand, textY);
  doc.text("Price", margin + COL.price, textY);
}

/**
 * The Bid11Pro wordmark (components/ds/logo.tsx): a red ball with its seam
 * and "Bid11Pro" with "11" in the signal colour, right-aligned to `right`
 * with the text baseline at `baseline`.
 */
function drawBid11ProMark(doc: jsPDF, right: number, baseline: number): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const parts: Array<[string, [number, number, number]]> = [
    ["Bid", [30, 30, 30]],
    ["11", [14, 116, 144]], // --fl-signal (light theme)
    ["Pro", [30, 30, 30]],
  ];
  const textW = parts.reduce((w, [t]) => w + doc.getTextWidth(t), 0);
  let x = right - textW;

  // Ball: the logo's 32-unit viewBox scaled to a 4.4 mm square.
  const size = 4.4;
  const k = size / 32;
  const ox = x - 1.5 - size;
  const oy = baseline - 1.1 - size / 2;
  doc.setFillColor(210, 47, 47);
  doc.circle(ox + 16 * k, oy + 16 * k, 14 * k, "F");
  // Seam: "M6 16 q5 ∓7 10 0 t10 0" as two quadratic curves per path, drawn as cubics.
  const seam = (dy: number, rgb: [number, number, number], width: number) => {
    const q = (c: number) => (2 / 3) * c * k; // quadratic → cubic control offset
    doc.setDrawColor(...rgb);
    doc.setLineWidth(width * k);
    doc.lines(
      [
        [q(5), q(dy), 10 * k - q(5), q(dy), 10 * k, 0],
        [q(5), -q(dy), 10 * k - q(5), -q(dy), 10 * k, 0],
      ],
      ox + 6 * k,
      oy + 16 * k,
      [1, 1],
      "S",
    );
  };
  seam(-7, [14, 116, 144], 1.8);
  seam(7, [255, 255, 255], 1.2);

  for (const [t, rgb] of parts) {
    doc.setTextColor(...rgb);
    doc.text(t, x, baseline);
    x += doc.getTextWidth(t);
  }
  doc.setFont("helvetica", "normal");
}

export async function generateTeamPdf(team: TeamData): Promise<void> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 20;

  const primaryColor = hexToRgb(team.colorPrimary);
  const branding = await loadPdfBranding(team);

  // Header background
  doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.rect(0, 0, pageWidth, 45, "F");

  // Team Logo (if available)
  let textStartX = margin;
  if (team.logoUrl) {
    try {
      const logoBase64 = await loadPdfImage(team.logoUrl, { format: "png" });
      if (logoBase64) {
        doc.addImage(logoBase64, pdfImageFormat(logoBase64) ?? "PNG", margin, 5, 35, 35);
        textStartX = margin + 42; // Shift text to the right of logo
      }
    } catch {
      // Logo failed to load, continue without it
    }
  }

  // Team Name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text(team.name, textStartX, 20);

  // Owner & Sponsor (directly under the team name, inside the header band)
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  const ownerText = `Owner: ${team.ownerName || "N/A"}${team.sponsorName ? ` | Sponsor: ${team.sponsorName}` : ""}`;
  doc.text(ownerText, textStartX, 29);

  // Tournament Name (if available)
  if (team.tournamentName) {
    doc.setFontSize(10);
    doc.text(team.tournamentName, textStartX, 37);
  }

  // Group badge (top-right of header, only present once the draw is locked)
  if (team.groupLabel) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    const labelW = doc.getTextWidth(team.groupLabel);
    const badgeW = labelW + 10;
    const badgeX = pageWidth - margin - badgeW;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(badgeX, 8, badgeW, 9, 2, 2, "F");
    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.text(team.groupLabel, badgeX + 5, 14.5);
  }

  // Organisation logo (top-right, on a white tile; under the group badge when there is one)
  if (branding.organizationLogo) {
    const size = team.groupLabel ? 24 : 32;
    const tileX = pageWidth - margin - size;
    const tileY = team.groupLabel ? 19 : 6.5;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(tileX, tileY, size, size, 2, 2, "F");
    drawContainedImage(doc, branding.organizationLogo, tileX + 1.5, tileY + 1.5, size - 3, size - 3);
  }

  y = 55;

  // Reset text color
  doc.setTextColor(30, 30, 30);

  // Purse Information Box
  doc.setFillColor(245, 245, 245);
  doc.roundedRect(margin, y, pageWidth - margin * 2, 30, 3, 3, "F");

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("PURSE DETAILS", margin + 5, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const purseY = y + 18;
  doc.text(
    `Total Spent: ${formatCurrencyFull(team.purseSpent)}`,
    margin + 5,
    purseY,
  );
  doc.text(
    `Remaining: ${formatCurrencyFull(team.purseRemaining)}`,
    margin + 70,
    purseY,
  );
  doc.text(
    `Total Purse: ${formatCurrencyFull(team.purseSpent + team.purseRemaining)}`,
    margin + 135,
    purseY,
  );

  y += 40;

  // Players Section Header
  doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.rect(margin, y, pageWidth - margin * 2, 10, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("SQUAD", margin + 5, y + 7);
  doc.text(`(${team.players.length} Players)`, margin + 40, y + 7);

  y += 15;
  doc.setTextColor(30, 30, 30);

  // Table Header
  doc.setFillColor(230, 230, 230);
  doc.rect(margin, y, pageWidth - margin * 2, 8, "F");

  drawTableHeader(doc, margin, y, team.couple);

  // Rows paint from y - 4, so start 12 below the 8-tall header to keep it clear.
  y += 12;

  // Players List
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  // Captain first, then the rest sorted by sold price (highest first)
  const sortedPlayers = [...team.players].sort((a, b) => {
    if (a.isCaptain && !b.isCaptain) return -1;
    if (!a.isCaptain && b.isCaptain) return 1;
    return (b.soldPrice || 0) - (a.soldPrice || 0);
  });

  const breakPageIfFull = () => {
    if (y > 270) {
      doc.addPage();
      y = 20;

      // Add header on new page
      doc.setFillColor(230, 230, 230);
      doc.rect(margin, y, pageWidth - margin * 2, 8, "F");
      drawTableHeader(doc, margin, y, team.couple);

      y += 12;
      doc.setFont("helvetica", "normal");
    }
  };
  // "Right-handed" / "Left-handed" → "Right" / "Left"
  const shortHand = (hand: string | undefined) => (!hand ? "-" : hand.includes("Right") ? "Right" : "Left");

  sortedPlayers.forEach((player, index) => {
    // Check if we need a new page
    breakPageIfFull();

    // Alternate row colors (captain gets a highlighted row instead)
    if (player.isCaptain) {
      doc.setFillColor(255, 247, 214);
      doc.rect(margin, y - 4, pageWidth - margin * 2, 8, "F");
    } else if (index % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(margin, y - 4, pageWidth - margin * 2, 8, "F");
    }

    doc.setFontSize(7);
    doc.setTextColor(30, 30, 30);
    doc.text(`${index + 1}`, margin + COL.index, y + 2);
    const displayName = player.isCaptain
      ? `${player.name} (C)`
      : player.name;
    doc.setFont("helvetica", player.isCaptain ? "bold" : "normal");
    doc.text(displayName.substring(0, 26), margin + COL.name, y + 2);
    doc.setFont("helvetica", "normal");
    doc.text(player.age != null ? `${player.age}` : "-", margin + COL.age, y + 2);
    doc.text(player.phoneNumber || "-", margin + COL.phone, y + 2);
    doc.text(`${player.jerseyNumber || "-"}`, margin + COL.jerseyNumber, y + 2);
    if (team.couple) {
      doc.text(player.gender || "-", margin + COL.gender, y + 2);
      doc.text(player.ranking != null ? `${player.ranking}` : "-", margin + COL.rank, y + 2);
    } else {
      doc.text((player.jerseyName || "-").substring(0, 16), margin + COL.jerseyName, y + 2);
    }
    doc.text(player.tshirtSize || "-", margin + COL.size, y + 2);
    doc.text(shortHand(player.battingBowlingHand), margin + COL.hand, y + 2);

    if (player.isCaptain && !player.soldPrice) {
      doc.setTextColor(120, 120, 120);
      doc.text("-", margin + COL.price, y + 2);
    } else {
      doc.setTextColor(34, 139, 34); // Green for price
      doc.text(formatCurrencyFull(player.soldPrice || 0), margin + COL.price, y + 2);
    }

    y += 8;

    // A couple's female member, on its own line under the couple.
    const partner = team.couple ? player.partner : undefined;
    if (partner) {
      breakPageIfFull();
      if (player.isCaptain) {
        doc.setFillColor(255, 247, 214);
        doc.rect(margin, y - 4, pageWidth - margin * 2, 8, "F");
      } else if (index % 2 === 0) {
        doc.setFillColor(250, 250, 250);
        doc.rect(margin, y - 4, pageWidth - margin * 2, 8, "F");
      }
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(90, 90, 90);
      doc.text("Female member", margin + COL.name + 2, y + 2);
      doc.text(partner.age != null ? `${partner.age}` : "-", margin + COL.age, y + 2);
      doc.text(partner.phoneNumber || "-", margin + COL.phone, y + 2);
      doc.text(`${partner.jerseyNumber || "-"}`, margin + COL.jerseyNumber, y + 2);
      doc.text(partner.gender, margin + COL.gender, y + 2);
      doc.text(partner.ranking != null ? `${partner.ranking}` : "-", margin + COL.rank, y + 2);
      doc.text(partner.tshirtSize || "-", margin + COL.size, y + 2);
      doc.text(shortHand(partner.battingBowlingHand), margin + COL.hand, y + 2);
      y += 8;
    }
  });

  // Sponsors under the squad (on a new page if they don't fit above the footer)
  const contentWidth = pageWidth - margin * 2;
  const sponsorsHeight = sponsorGridHeight(branding.sponsors.length, contentWidth, SPONSOR_LAYOUT);
  if (sponsorsHeight > 0) {
    y += 4;
    if (y + sponsorsHeight > 265) {
      doc.addPage();
      y = 20;
    }
    y += drawSponsorGrid(doc, branding.sponsors, margin, y, contentWidth, SPONSOR_LAYOUT, "light");
  }

  // Footer
  y = Math.max(y + 10, 270);
  if (y > 280) {
    doc.addPage();
    y = 20;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);

  doc.setTextColor(150, 150, 150);
  doc.setFontSize(8);
  doc.text(
    `Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`,
    margin,
    y + 8,
  );
  drawBid11ProMark(doc, pageWidth - margin, y + 8);

  // Save the PDF
  const fileName = `${team.name.replace(/\s+/g, "_")}_Squad.pdf`;
  doc.save(fileName);
}
