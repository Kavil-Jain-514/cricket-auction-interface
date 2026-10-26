"use client";

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { ShieldCheck, ShieldAlert, Shield } from 'lucide-react';

/**
 * Admin-console badge proving every purse and status count is correct
 * (auctions:getReconciliation). Render it ONLY for admins: the subscription
 * lives in this component, so it exists only while the admin console is open
 * and never touches the viewer hot path.
 */
export function ReconciliationBadge({ tournamentId }: { tournamentId: Id<"tournaments"> }) {
  const result = useQuery(api.auctions.getReconciliation, { tournamentId });
  const [open, setOpen] = useState(false);

  if (result === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
        <Shield className="w-3.5 h-3.5" />
        Checking totals…
      </span>
    );
  }

  if (result.ok) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-green-500/40 bg-green-500/10 px-1.5 py-0.5 text-[11px] font-medium text-green-300"
        title="Every team's purse matches its sold players and the status counts are in sync"
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        Totals verified
      </span>
    );
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-red-500/50 bg-red-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/25"
      >
        <ShieldAlert className="w-3.5 h-3.5" />
        {result.issues.length} total{result.issues.length > 1 ? 's' : ''} off
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 sm:w-96 rounded-lg border border-red-500/40 bg-slate-900 p-3 shadow-xl">
          <p className="mb-2 text-xs font-semibold text-red-300">Reconciliation issues</p>
          <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs text-slate-300">
            {result.issues.map((issue, idx) => (
              <li key={idx} className="border-l-2 border-red-500/60 pl-2">
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
