// lib/resultsWorkbook.ts
// Sheets for "Export results (.xlsx)", built from results:getResultsExport.
// Pure (rows only) so it is unit-testable; the button turns the rows into a
// workbook with the xlsx package. Money is written as plain rupee numbers so
// the sheets can be summed.
import { categoryFor, teamPurseTotal, type PlayerCategory } from '@/convex/bidRules';
import { formatCurrency, getRoleDisplay } from '@/lib/utils';

type Status = 'pending' | 'in_auction' | 'sold' | 'unsold' | 'final_unsold';

export interface ResultsExportData {
  tournament: { name: string; basePurse: number };
  categories: PlayerCategory[];
  teams: Array<{
    _id: string;
    name: string;
    purseSpent: number;
    purseRemaining: number;
    /** Admin penalties / top-ups; the team's purse is basePurse + this. */
    purseAdjustment?: number;
    captainPlayerId?: string;
  }>;
  players: Array<{
    _id: string;
    name: string;
    role: string | string[];
    categoryId?: string;
    auctionStatus: Status;
    teamId?: string;
    soldPrice?: number;
    basePrice: number;
  }>;
  sales: Array<{ playerId: string; teamId: string; amount: number; timestamp: number; bidCount?: number }>;
  contacts: Array<{ name: string; phoneNumber: string; teamName: string; auctionStatus: Status }> | null;
}

export type Cell = string | number;
export type Sheets = Record<string, Cell[][]>;

const UNSOLD_STATUS: Partial<Record<Status, string>> = {
  unsold: 'Unsold',
  final_unsold: 'Removed (final unsold)',
  pending: 'Not auctioned',
};

const STATUS_LABEL: Record<Status, string> = {
  pending: 'Pending',
  in_auction: 'In auction',
  sold: 'Sold',
  unsold: 'Unsold',
  final_unsold: 'Final unsold',
};

/** "26 Oct 2026, 18:00" in India time, the same on every machine. */
export function formatSaleTime(timestamp: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(timestamp))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

export function buildResultsSheets(data: ResultsExportData): Sheets {
  const captainIds = new Set(data.teams.flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])));
  const teamName = new Map(data.teams.map((t) => [t._id, t.name]));
  const categoryName = (id?: string) => categoryFor(id, data.categories)?.name ?? '';
  const byPrice = (a: { soldPrice?: number }, b: { soldPrice?: number }) => (b.soldPrice ?? 0) - (a.soldPrice ?? 0);
  const squadOf = (teamId: string) =>
    data.players
      .filter((p) => p.auctionStatus === 'sold' && p.teamId === teamId && !captainIds.has(p._id))
      .sort(byPrice);

  // Squads: captain first (free, outside the squad), then buys by price.
  const squads: Cell[][] = [['Team', 'Player', 'Role', 'Category', 'Price (₹)', 'Captain']];
  for (const team of data.teams) {
    const captain = data.players.find((p) => p._id === team.captainPlayerId);
    if (captain) {
      squads.push([team.name, captain.name, getRoleDisplay(captain.role), categoryName(captain.categoryId), 0, 'Yes']);
    }
    for (const p of squadOf(team._id)) {
      squads.push([team.name, p.name, getRoleDisplay(p.role), categoryName(p.categoryId), p.soldPrice ?? 0, '']);
    }
  }

  const summary: Cell[][] = [
    ['Team', 'Purse (₹)', 'Spent (₹)', 'Remaining (₹)', 'Players', 'Average price (₹)', 'Most expensive buy'],
  ];
  for (const team of data.teams) {
    const squad = squadOf(team._id);
    const total = squad.reduce((sum, p) => sum + (p.soldPrice ?? 0), 0);
    const top = squad[0];
    summary.push([
      team.name,
      teamPurseTotal(data.tournament.basePurse, team),
      team.purseSpent,
      team.purseRemaining,
      squad.length,
      squad.length ? Math.round(total / squad.length) : 0,
      top ? `${top.name} (${formatCurrency(top.soldPrice ?? 0)})` : '',
    ]);
  }

  const unsold: Cell[][] = [['Player', 'Role', 'Category', 'Base price (₹)', 'Status']];
  for (const p of data.players) {
    const status = UNSOLD_STATUS[p.auctionStatus];
    if (!status || captainIds.has(p._id)) continue;
    unsold.push([p.name, getRoleDisplay(p.role), categoryName(p.categoryId), p.basePrice, status]);
  }

  // Sale log: final truth from players; order, time and bid count from each
  // player's latest sale event. A row whose team or price differs from that
  // event was corrected by an admin afterwards; a sold player with no event
  // was assigned by an admin.
  const latestSale = new Map<string, ResultsExportData['sales'][number]>();
  for (const sale of [...data.sales].sort((a, b) => a.timestamp - b.timestamp)) {
    latestSale.set(sale.playerId, sale);
  }
  const soldPlayers = data.players.filter((p) => p.auctionStatus === 'sold' && p.teamId && !captainIds.has(p._id));
  const withEvent = soldPlayers
    .filter((p) => latestSale.has(p._id))
    .sort((a, b) => latestSale.get(a._id)!.timestamp - latestSale.get(b._id)!.timestamp);
  const withoutEvent = soldPlayers.filter((p) => !latestSale.has(p._id)).sort((a, b) => a.name.localeCompare(b.name));

  const log: Cell[][] = [['Order', 'Player', 'Team', 'Price (₹)', 'Time (IST)', 'Bids', 'Note']];
  withEvent.forEach((p, i) => {
    const sale = latestSale.get(p._id)!;
    const changed = sale.teamId !== p.teamId || sale.amount !== p.soldPrice;
    log.push([
      i + 1,
      p.name,
      teamName.get(p.teamId!) ?? '',
      p.soldPrice ?? 0,
      formatSaleTime(sale.timestamp),
      sale.bidCount ?? '',
      changed
        ? `Changed after the sale (was ${teamName.get(sale.teamId) ?? 'another team'} at ${formatCurrency(sale.amount)})`
        : '',
    ]);
  });
  for (const p of withoutEvent) {
    log.push(['', p.name, teamName.get(p.teamId!) ?? '', p.soldPrice ?? 0, '', '', 'Assigned by an admin']);
  }

  const sheets: Sheets = { Squads: squads, 'Team summary': summary, Unsold: unsold, 'Sale log': log };
  if (data.contacts) {
    sheets.Contacts = [
      ['Player', 'Phone', 'Team', 'Status'],
      ...data.contacts.map((c) => [c.name, c.phoneNumber, c.teamName, STATUS_LABEL[c.auctionStatus]]),
    ];
  }
  return sheets;
}
