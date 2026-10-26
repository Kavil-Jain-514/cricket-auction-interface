"use client";

import { Doc } from '@/convex/_generated/dataModel';
import { formatCurrency, getRoles, getRoleBadgeBg, getStatusBadgeBg, getErrorMessage } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Edit, Trash2 } from 'lucide-react';
import { PlayerEditForm } from './PlayerEditForm';
import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { useUserRole } from '@/hooks/useUserRole';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { CategoryChip } from './CategoryChip';
import type { PlayerCategory } from '@/convex/bidRules';

interface PlayerCardProps {
  /** From players:listByTournament (basePrice resolved, plus the raw override). */
  player: Doc<"players"> & { basePriceOverride?: number };
  onClick?: () => void;
  /** True when this player is a team captain — shows a "C" tag */
  isCaptain?: boolean;
  /** Tournament categories, for the category chip. */
  categories?: PlayerCategory[];
}

export function PlayerCard({ player, onClick, isCaptain, categories }: PlayerCardProps) {
  const [showEdit, setShowEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletePlayer = useMutation(api.players.deletePlayer);
  const { isAdmin } = useUserRole();
  const confirm = useConfirm();

  // Can edit if admin AND player is pending/unsold (not sold or in_auction) —
  // editing attributes of a final_unsold (terminal) player isn't meaningful.
  const canModify = isAdmin && (player.auctionStatus === "pending" || player.auctionStatus === "unsold");
  // Deleting is allowed for final_unsold too — deletePlayer permits it
  // (only sold/in_auction are blocked), so leaving no way to remove these
  // from the UI was a capability gap, not an intentional restriction.
  const canDelete = canModify || player.auctionStatus === "final_unsold";

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(await confirm({
      title: `Delete ${player.name}?`,
      description: 'This action cannot be undone.',
      confirmText: 'Delete Player',
    }))) {
      return;
    }

    setDeleting(true);
    try {
      await deletePlayer({ id: player._id });
      toast.success('Player deleted successfully');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete player'));
    } finally {
      setDeleting(false);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowEdit(true);
  };

  return (
    <>
      <motion.div
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        className={`bg-slate-800/50 border border-slate-700 rounded-xl p-3 sm:p-4 hover:border-blue-500 transition relative ${onClick ? 'cursor-pointer' : ''}`}
      >
        {/* Player Avatar */}
        <div className="flex items-start gap-2.5 sm:gap-3 mb-3">
          <div className="relative shrink-0">
            <PlayerAvatar
              name={player.name}
              photoUrl={player.photoUrl}
              size="lg"
            />
            {isCaptain && (
              <span
                title="Team Captain"
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-yellow-500 text-slate-950 text-[11px] font-extrabold flex items-center justify-center border-2 border-slate-900 shadow"
              >
                C
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base sm:text-lg truncate">{player.name}</h3>
            <p className="text-xs sm:text-sm text-slate-400">{player.age} years</p>
            <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-1.5">
              {getRoles(player.role).map((r) => (
                <span key={r} className={`px-2 py-0.5 sm:py-1 ${getRoleBadgeBg(r)} rounded text-xs font-semibold`}>
                  {r}
                </span>
              ))}
              <CategoryChip categoryId={player.categoryId} categories={categories} className="rounded py-0.5 sm:py-1" />
              <span className={`px-2 py-0.5 sm:py-1 ${getStatusBadgeBg(player.auctionStatus)} rounded text-xs font-semibold`}>
                {player.auctionStatus}
              </span>
            </div>
          </div>
        </div>

        {/* Player Details */}
        <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Batting/Bowling</span>
            <span className="font-semibold">{player.battingBowlingHand}</span>
          </div>

          <div className="flex flex-col">
            <span className="text-xs text-slate-400">Base Price</span>
            <span className="font-semibold text-white">
              {formatCurrency(player.basePrice ?? 100000)}
            </span>
          </div>

          {player.soldPrice && (
            <div className="flex justify-between">
              <span className="text-slate-400">Sold Price</span>
              <span className="font-semibold text-yellow-400">
                {formatCurrency(player.soldPrice)}
              </span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {(canModify || canDelete) && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-3 pt-3 border-t border-slate-700 flex items-center justify-end gap-0.5 -mr-1 -mb-1"
          >
            {canModify && (
              <button
                onClick={handleEdit}
                className="flex items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-blue-500/15 hover:text-blue-400 active:scale-95 touch-target"
                aria-label="Edit player"
                title="Edit Player"
              >
                <Edit className="h-4 w-4" />
              </button>
            )}
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-500/15 hover:text-red-400 active:scale-95 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent disabled:active:scale-100 touch-target"
                aria-label="Delete player"
                title="Delete Player"
              >
                {deleting ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-red-400/40 border-t-red-400" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        )}
      </motion.div>
      {/* Edit Modal */}
      {showEdit && (
        <PlayerEditForm
          player={player}
          onClose={() => setShowEdit(false)}
          onSuccess={() => setShowEdit(false)}
        />
      )}
    </>
  );
}