// Squad rows for the team PDF (lib/generateTeamPdf.ts), captain included.

export interface PdfPlayer {
  name: string;
  role: string;
  soldPrice?: number;
  age?: number;
  jerseyNumber?: number;
  jerseyName?: string;
  /** Absent for a hand-entered captain whose hand was left blank. */
  battingBowlingHand?: string;
  phoneNumber?: string;
  tshirtSize?: string;
  isCaptain?: boolean;
}

/** The player fields the PDF reads (a players doc; phone only for staff). */
export interface PdfSourcePlayer {
  _id: string;
  name: string;
  role: string | string[];
  battingBowlingHand: string;
  age?: number;
  soldPrice?: number;
  jerseyNumber?: number;
  jerseyName?: string;
  tshirtSize?: string;
  teamId?: string;
  phoneNumber?: string;
}

/** The team's captain fields (a teams doc). */
export interface PdfSourceTeam {
  _id: string;
  captainPlayerId?: string;
  captainName?: string;
  captainAge?: number;
  captainRole?: string;
  captainHand?: "Right" | "Left";
}

function toRow(p: PdfSourcePlayer, isCaptain: boolean): PdfPlayer {
  return {
    name: p.name,
    age: p.age,
    role: Array.isArray(p.role) ? p.role.join(", ") : p.role,
    soldPrice: p.soldPrice,
    jerseyNumber: p.jerseyNumber,
    jerseyName: p.jerseyName,
    battingBowlingHand: p.battingBowlingHand,
    phoneNumber: p.phoneNumber,
    tshirtSize: p.tshirtSize,
    isCaptain,
  };
}

/**
 * The team's squad plus its captain. A captain picked from the players is
 * usually not sold to the team, so it is added from the player list; a
 * captain entered by hand exists only as the team's captain* fields.
 */
export function buildTeamPdfPlayers(team: PdfSourceTeam, players: PdfSourcePlayer[]): PdfPlayer[] {
  const rows = players
    .filter((p) => p.teamId === team._id)
    .map((p) => toRow(p, p._id === team.captainPlayerId));
  if (rows.some((r) => r.isCaptain)) return rows;

  if (team.captainPlayerId) {
    const captain = players.find((p) => p._id === team.captainPlayerId);
    if (captain) rows.unshift(toRow(captain, true));
    return rows;
  }

  const name = team.captainName?.trim();
  if (name) {
    rows.unshift({
      name,
      age: team.captainAge,
      role: team.captainRole ?? "",
      battingBowlingHand: team.captainHand ? `${team.captainHand}-handed` : undefined,
      isCaptain: true,
    });
  }
  return rows;
}
