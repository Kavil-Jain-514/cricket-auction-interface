import { jsPDF } from "jspdf";
import { formatCurrencyFull } from "@/lib/utils";

interface Player {
  name: string;
  role: string;
  soldPrice?: number;
  age: number;
  jerseyNumber?: number;
  jerseyName?: string;
  battingBowlingHand: string;
  phoneNumber?: string;
  tshirtSize?: string;
}

interface TeamData {
  name: string;
  ownerName: string;
  sponsorName?: string;
  colorPrimary: string;
  colorSecondary: string;
  purseRemaining: number;
  purseSpent: number;
  captainName?: string;
  captainAge?: number;
  captainRole?: string;
  captainHand?: string;
  players: Player[];
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

// Role badge: colored pill with short abbreviation
function getRoleBadgeStyle(role: string): {
  abbr: string;
  r: number;
  g: number;
  b: number;
} {
  const lower = role.toLowerCase();
  if (lower.includes("wicket") || lower === "wk")
    return { abbr: "WK", r: 16, g: 185, b: 129 }; // emerald
  if (lower.includes("all")) return { abbr: "AR", r: 147, g: 51, b: 234 }; // purple
  if (lower.includes("bowl")) return { abbr: "BOWL", r: 234, g: 88, b: 12 }; // orange
  return { abbr: "BAT", r: 59, g: 130, b: 246 }; // blue
}

function drawRoleBadge(doc: jsPDF, role: string, x: number, y: number): void {
  // Use primary role only (first item if comma-separated)
  const primaryRole = role.split(",")[0].trim();
  const { abbr, r, g, b } = getRoleBadgeStyle(primaryRole);
  const badgeW = abbr.length <= 2 ? 9 : abbr.length === 3 ? 12 : 15;
  const badgeH = 5;

  doc.setFillColor(r, g, b);
  doc.roundedRect(x, y - 3.5, badgeW, badgeH, 1, 1, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "bold");
  // Center text manually — avoids align option incompatibility with jsPDF 4.x
  const textW = doc.getTextWidth(abbr);
  doc.text(abbr, x + (badgeW - textW) / 2, y + 0.5);
  // Reset
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
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
  const secondaryColor = hexToRgb(team.colorSecondary);

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
  doc.text(team.name, textStartX, y + 10);

  // Tournament Name (if available)
  if (team.tournamentName) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(team.tournamentName, textStartX, y + 20);
  }

  // Owner & Sponsor
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  const ownerText = `Owner: ${team.ownerName || "N/A"}${team.sponsorName ? ` | Sponsor: ${team.sponsorName}` : ""}`;
  doc.text(ownerText, textStartX, y + 30);

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

  // Captain Section (if available)
  if (team.captainName) {
    doc.setFillColor(secondaryColor.r, secondaryColor.g, secondaryColor.b);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 25, 3, 3, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("CAPTAIN", margin + 5, y + 8);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const captainDetails = [
      team.captainName,
      team.captainAge ? `Age: ${team.captainAge}` : "",
      team.captainRole || "",
      team.captainHand ? `${team.captainHand}-handed` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    doc.text(captainDetails, margin + 5, y + 18);

    y += 35;
    doc.setTextColor(30, 30, 30);
  }

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

  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("#", margin + 2, y + 6);
  doc.text("Player Name", margin + 8, y + 6);
  doc.text("Age", margin + 35, y + 6);
  doc.text("Phone", margin + 45, y + 6);
  doc.text("Role", margin + 65, y + 6);
  doc.text("Jersey#", margin + 90, y + 6);
  doc.text("Jersey Name", margin + 102, y + 6);
  doc.text("Size", margin + 128, y + 6);
  doc.text("Hand", margin + 140, y + 6);
  doc.text("Price", margin + 153, y + 6);

  y += 10;

  // Players List
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  // Sort players by sold price (highest first)
  const sortedPlayers = [...team.players].sort(
    (a, b) => (b.soldPrice || 0) - (a.soldPrice || 0),
  );

  sortedPlayers.forEach((player, index) => {
    // Check if we need a new page
    if (y > 270) {
      doc.addPage();
      y = 20;

      // Add header on new page
      doc.setFillColor(230, 230, 230);
      doc.rect(margin, y, pageWidth - margin * 2, 8, "F");

      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text("#", margin + 2, y + 6);
      doc.text("Player Name", margin + 8, y + 6);
      doc.text("Age", margin + 35, y + 6);
      doc.text("Phone", margin + 45, y + 6);
      doc.text("Role", margin + 65, y + 6);
      doc.text("Jersey#", margin + 90, y + 6);
      doc.text("Jersey Name", margin + 102, y + 6);
      doc.text("Size", margin + 128, y + 6);
      doc.text("Hand", margin + 140, y + 6);
      doc.text("Price", margin + 153, y + 6);

      y += 10;
      doc.setFont("helvetica", "normal");
    }

    // Alternate row colors
    if (index % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(margin, y - 4, pageWidth - margin * 2, 8, "F");
    }

    doc.setFontSize(7);
    doc.setTextColor(30, 30, 30);
    doc.text(`${index + 1}`, margin + 2, y + 2);
    doc.text(player.name.substring(0, 18), margin + 8, y + 2);
    doc.text(player.age != null ? `${player.age}` : "-", margin + 35, y + 2);
    doc.text(player.phoneNumber || "-", margin + 45, y + 2);
    drawRoleBadge(doc, player.role, margin + 65, y + 2);
    doc.text(`${player.jerseyNumber || "-"}`, margin + 90, y + 2);
    doc.text((player.jerseyName || "-").substring(0, 10), margin + 102, y + 2);
    doc.text(player.tshirtSize || "-", margin + 128, y + 2);

    // Simplify hand display
    const hand = player.battingBowlingHand.includes("Right") ? "R" : "L";
    doc.text(hand, margin + 140, y + 2);

    doc.setTextColor(34, 139, 34); // Green for price
    doc.text(formatCurrencyFull(player.soldPrice || 0), margin + 153, y + 2);

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
