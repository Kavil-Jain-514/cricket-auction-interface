"use client";

import { StatusBrowser, type StatusFilter } from '@/components/tournament/TournamentBrowser';
import { useStoredChoice } from '@/hooks/useStoredChoice';

const FILTERS = ['all', 'live', 'upcoming', 'completed', 'inactive'] as const;

/** Super-admin: every tournament, deactivated ones included, filtered and paged on the server. */
export default function AdminTournamentsPage() {
  const [filter, setFilter] = useStoredChoice<StatusFilter>('bid11pro.admin.tournaments.filter', 'all', FILTERS);
  return <StatusBrowser admin filter={filter} onFilterChange={setFilter} />;
}
