"use client";

import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { MoreVertical, Eraser, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from '@/lib/utils';

interface ConsoleMoreMenuProps {
  auctionRoomId: Id<"auctionRooms">;
  /** Name of the player on the block, or null when there is none. */
  currentPlayerName: string | null;
  bidCount: number;
}

/** Console overflow menu: rarely used, destructive actions that need a reason. */
export function ConsoleMoreMenu({ auctionRoomId, currentPlayerName, bidCount }: ConsoleMoreMenuProps) {
  const clearBids = useMutation(api.admin.clearCurrentPlayerBids);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleClear = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const res = await clearBids({ auctionRoomId, reason });
      toast.success(res.message);
      setDialogOpen(false);
      setReason('');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not clear the bids'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="outline"
        size="lg"
        onClick={() => setMenuOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="More actions"
        className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white h-10 sm:h-11 px-2.5 touch-target"
      >
        <MoreVertical className="w-4 h-4 sm:w-5 sm:h-5" />
      </Button>

      {menuOpen && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
          <button
            type="button"
            role="menuitem"
            disabled={!currentPlayerName || bidCount === 0}
            onClick={() => {
              setMenuOpen(false);
              setDialogOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Eraser className="w-4 h-4" /> Clear all bids…
          </button>
        </div>
      )}

      {dialogOpen && currentPlayerName && (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/80 p-4" onClick={() => setDialogOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-bids-title"
            className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="clear-bids-title" className="text-lg font-bold">Clear all bids on {currentPlayerName}?</h2>
              <button onClick={() => setDialogOpen(false)} className="p-1 text-slate-400 hover:text-white" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="mb-3 text-sm text-slate-400">
              All {bidCount} bid{bidCount === 1 ? '' : 's'} are removed and bidding starts again from the base price. The player stays on the block.
            </p>
            <Label htmlFor="clear-reason" className="text-xs">Reason (required, saved to the audit log)</Label>
            <Textarea id="clear-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bids called for the wrong team" className="mt-1 min-h-20" autoFocus />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
                Cancel
              </Button>
              <Button variant="destructive" disabled={!reason.trim() || busy} onClick={handleClear}>
                {busy ? 'Clearing…' : 'Clear bids'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
