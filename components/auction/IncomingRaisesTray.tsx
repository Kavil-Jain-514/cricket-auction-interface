"use client";

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Check, X, Hand } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { formatCurrency, getErrorMessage } from '@/lib/utils';

interface IncomingRaisesTrayProps {
  auctionRoomId: Id<"auctionRooms">;
}

/** Enter should not fire while the auctioneer is typing or a dialog is open. */
function enterBelongsToSomethingElse(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (el?.closest('input, textarea, select, button, a, [contenteditable="true"]')) return true;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
}

/**
 * Confirm-mode console tray: owners' raises waiting for the auctioneer.
 * The newest raise that is still valid (≥ the minimum next bid) is
 * highlighted and accepted with Enter. Accepting re-validates on the server,
 * so a raise that went stale between render and click fails with a reason.
 */
export function IncomingRaisesTray({ auctionRoomId }: IncomingRaisesTrayProps) {
  const tray = useQuery(api.auctions.getPendingBidRequests, { auctionRoomId });
  const acceptRequest = useMutation(api.auctions.acceptBidRequest);
  const rejectRequest = useMutation(api.auctions.rejectBidRequest);
  const [busyId, setBusyId] = useState<string | null>(null);

  const requests = tray?.requests ?? [];
  const minNextBid = tray?.minNextBid ?? null;
  // Newest first from the server, so the first valid one is the newest valid.
  const highlighted = requests.find((r) => minNextBid !== null && r.amount >= minNextBid);

  const accept = useCallback(async (requestId: Id<"bidRequests">) => {
    setBusyId(requestId);
    try {
      const res = await acceptRequest({ requestId });
      if (!res.success) toast.error(res.reason);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to accept raise'));
    } finally {
      setBusyId(null);
    }
  }, [acceptRequest]);

  const reject = async (requestId: Id<"bidRequests">) => {
    setBusyId(requestId);
    try {
      const res = await rejectRequest({ requestId });
      if (!res.success) toast.error(res.reason);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to reject raise'));
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    if (!highlighted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || enterBelongsToSomethingElse(e)) return;
      e.preventDefault();
      accept(highlighted._id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [highlighted, accept]);

  return (
    <section className="mb-4 rounded-xl border border-slate-700 bg-slate-900/60 p-3" aria-label="Incoming raises">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
        <Hand className="w-4 h-4 text-amber-400" />
        Incoming raises
        {requests.length > 0 && (
          <span className="ml-auto text-[11px] font-normal text-slate-400">Enter accepts the highlighted raise</span>
        )}
      </h3>

      {requests.length === 0 ? (
        <p className="text-xs text-slate-500">No raises waiting.</p>
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => {
            const isHighlighted = r._id === highlighted?._id;
            const isStale = minNextBid !== null && r.amount < minNextBid;
            return (
              <li
                key={r._id}
                className={`flex items-center gap-2 rounded-lg border-l-4 px-3 py-2 ${
                  isHighlighted ? 'bg-amber-500/15 ring-1 ring-amber-400' : 'bg-slate-800/70'
                } ${isStale ? 'opacity-50' : ''}`}
                style={{ borderLeftColor: r.colorPrimary }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{r.teamName}</p>
                  <p className="text-xs text-slate-400">
                    {formatCurrency(r.amount)}
                    {isStale && ' · below current price'}
                  </p>
                </div>
                <button
                  onClick={() => accept(r._id)}
                  disabled={busyId !== null}
                  className="flex items-center gap-1 rounded-lg bg-green-600 hover:bg-green-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 touch-target"
                  aria-label={`Accept ${r.teamName} at ${formatCurrency(r.amount)}`}
                >
                  <Check className="w-4 h-4" /> Accept
                </button>
                <button
                  onClick={() => reject(r._id)}
                  disabled={busyId !== null}
                  className="flex items-center rounded-lg bg-slate-700 hover:bg-red-600 p-1.5 text-white disabled:opacity-50 touch-target"
                  aria-label={`Reject ${r.teamName}'s raise`}
                  title="Reject"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
