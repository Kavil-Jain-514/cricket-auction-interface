// Squad rows for the team PDF (lib/generateTeamPdf.ts), captain included.
import { GENDER_LABEL, type CoupleFields } from "@/lib/couple";

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
  // Couple tournaments only (buildTeamPdfPlayers' `couple` option):
  /** "Male" / "Female"; a couple's row is its male member. */
  gender?: string;
  ranking?: number;
  /** The couple's female member, printed on the line under the row. */
  partner?: {
    age?: number;
    phoneNumber?: string;
    jerseyNumber?: number;
    tshirtSize?: string;
    battingBowlingHand: string;
    gender: string;
    ranking?: number;
  };
}

/** The player fields the PDF reads (a players doc; phone only for staff). */
export interface PdfSourcePlayer extends CoupleFields {
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

/** The couple-only fields of a row (none for standard tournaments). */
function coupleRow(p: PdfSourcePlayer): Pick<PdfPlayer, "gender" | "ranking" | "partner"> {
  const partner = p.partner;
  // A couple entry stores no gender: its row is the male member.
  const gender = partner ? GENDER_LABEL.male : p.gender ? GENDER_LABEL[p.gender] : undefined;
  return {
    gender,
    ranking: p.ranking,
    ...(partner
      ? {
          partner: {
            age: partner.age,
            phoneNumber: partner.phoneNumber,
            jerseyNumber: partner.jerseyNumber,
            tshirtSize: partner.tshirtSize,
            battingBowlingHand: partner.battingBowlingHand,
            gender: GENDER_LABEL.female,
            ranking: partner.ranking,
          },
        }
      : {}),
  };
}

function toRow(p: PdfSourcePlayer, isCaptain: boolean, couple: boolean): PdfPlayer {
  return {
    ...(couple ? coupleRow(p) : {}),
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
 * `couple` (couple tournaments) adds each row's gender, ranking and female member.
 */
export function buildTeamPdfPlayers(
  team: PdfSourceTeam,
  players: PdfSourcePlayer[],
  opts: { couple?: boolean } = {},
): PdfPlayer[] {
  const couple = opts.couple === true;
  const rows = players
    .filter((p) => p.teamId === team._id)
    .map((p) => toRow(p, p._id === team.captainPlayerId, couple));
  if (rows.some((r) => r.isCaptain)) return rows;

  if (team.captainPlayerId) {
    const captain = players.find((p) => p._id === team.captainPlayerId);
    if (captain) rows.unshift(toRow(captain, true, couple));
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
