// app/(app)/results/[tournamentId]/page.tsx
// Public auction results. The one server component among the pages: Open
// Graph tags must be in the server-rendered HTML so a WhatsApp share shows a
// preview card. The page body is the client ResultsView (live Convex query).
import type { Metadata } from 'next';
import { fetchQuery } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { formatCurrency } from '@/lib/utils';
import { ResultsView } from '@/components/results/ResultsView';

interface ResultsPageProps {
  params: Promise<{ tournamentId: string }>;
}

async function loadResults(tournamentId: string) {
  try {
    return await fetchQuery(api.results.getPublicResults, {
      tournamentId: tournamentId as Id<"tournaments">,
    });
  } catch {
    return null; // not a valid tournament id
  }
}

export async function generateMetadata({ params }: ResultsPageProps): Promise<Metadata> {
  const { tournamentId } = await params;
  const results = await loadResults(tournamentId);
  if (!results) {
    return { title: 'Results not available', robots: { index: false } };
  }

  const title = `${results.tournament.name} — Auction results`;
  const top = results.topBuys[0];
  const description = [
    `${results.totals.sold} players sold to ${results.teams.length} teams`,
    top ? `Top buy: ${top.name} for ${formatCurrency(top.soldPrice)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Images come from opengraph-image.tsx / twitter-image.tsx next to this page.
  return {
    title,
    description,
    alternates: { canonical: `/results/${tournamentId}` },
    openGraph: { type: 'website', title, description, url: `/results/${tournamentId}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function ResultsPage({ params }: ResultsPageProps) {
  const { tournamentId } = await params;
  return <ResultsView tournamentId={tournamentId} />;
}
