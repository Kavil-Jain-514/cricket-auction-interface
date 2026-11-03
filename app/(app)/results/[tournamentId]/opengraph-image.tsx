import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OG_SIZE, ogCard } from "@/lib/og/card";
import { formatCurrency } from "@/lib/utils";

// "<Tournament>: top buy <Player> ₹X" for WhatsApp / social shares.
export const alt = "Auction results on Bid11Pro";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  const results = await fetchQuery(api.results.getPublicResults, {
    tournamentId: tournamentId as Id<"tournaments">,
  }).catch(() => null); // not a valid tournament id

  if (!results) {
    return ogCard({ eyebrow: "Auction results", title: "Results not available yet" });
  }

  const top = results.topBuys[0];
  return ogCard({
    eyebrow: "Auction results",
    title: top ? `${results.tournament.name}: top buy ${top.name}` : results.tournament.name,
    detail: `${results.totals.sold} players sold to ${results.teams.length} teams`,
    price: top ? formatCurrency(top.soldPrice) : undefined,
  });
}
