import { jsPDF } from "jspdf";
import { formatCurrencyFull } from "@/lib/utils";
import type { PdfPlayer } from "@/lib/teamPdfPlayers";

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
}


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
  size: 126,
  hand: 139,
  price: 152,
} as const;

// Squad table column labels, vertically centred in the 8-tall header band at `y`.
function drawTableHeader(doc: jsPDF, margin: number, y: number): void {
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  const textY = y + 5.3;
  doc.text("#", margin + COL.index, textY);
  doc.text("Player Name", margin + COL.name, textY);
  doc.text("Age", margin + COL.age, textY);
  doc.text("Phone", margin + COL.phone, textY);
  doc.text("Jersey#", margin + COL.jerseyNumber, textY);
  doc.text("Jersey Name", margin + COL.jerseyName, textY);
  doc.text("Size", margin + COL.size, textY);
  doc.text("Hand", margin + COL.hand, textY);
  doc.text("Price", margin + COL.price, textY);
}

// Helper function to load image as base64
async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateTeamPdf(team: TeamData): Promise<void> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 20;

  const primaryColor = hexToRgb(team.colorPrimary);

  // Header background
  doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.rect(0, 0, pageWidth, 45, "F");

  // Team Logo (if available)
  let textStartX = margin;
  if (team.logoUrl) {
    try {
      const logoBase64 = await loadImageAsBase64(team.logoUrl);
      if (logoBase64) {
        doc.addImage(logoBase64, "PNG", margin, 5, 35, 35);
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

  drawTableHeader(doc, margin, y);

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

  sortedPlayers.forEach((player, index) => {
    // Check if we need a new page
    if (y > 270) {
      doc.addPage();
      y = 20;

      // Add header on new page
      doc.setFillColor(230, 230, 230);
      doc.rect(margin, y, pageWidth - margin * 2, 8, "F");
      drawTableHeader(doc, margin, y);

      y += 12;
      doc.setFont("helvetica", "normal");
    }

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
    doc.text((player.jerseyName || "-").substring(0, 16), margin + COL.jerseyName, y + 2);
    doc.text(player.tshirtSize || "-", margin + COL.size, y + 2);

    // "Right-handed" / "Left-handed" → "Right" / "Left"
    const hand = !player.battingBowlingHand
      ? "-"
      : player.battingBowlingHand.includes("Right") ? "Right" : "Left";
    doc.text(hand, margin + COL.hand, y + 2);

    if (player.isCaptain && !player.soldPrice) {
      doc.setTextColor(120, 120, 120);
      doc.text("-", margin + COL.price, y + 2);
    } else {
      doc.setTextColor(34, 139, 34); // Green for price
      doc.text(formatCurrencyFull(player.soldPrice || 0), margin + COL.price, y + 2);
    }

    y += 8;
  });

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
  doc.text("Cricket Auction System", pageWidth - margin - 40, y + 8);

  // Save the PDF
  const fileName = `${team.name.replace(/\s+/g, "_")}_Squad.pdf`;
  doc.save(fileName);
}
