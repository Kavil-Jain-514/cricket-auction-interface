"use client";

import { Doc } from '@/convex/_generated/dataModel';
import { formatCurrency } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Calendar, Edit, Trash2 } from 'lucide-react';
import { PlayerEditForm } from './PlayerEditForm';
import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';
import { PlayerAvatar } from '@/components/ui/player-avatar';

interface PlayerCardProps {
  player: Doc<"players">;
}

const roleColors: Record<string, string> = {
  'Batter': 'bg-blue-600',
  'Bowler': 'bg-orange-600',
  'All-Rounder': 'bg-purple-600',
  'All Rounder': 'bg-purple-600',
  'Wicket-Keeper': 'bg-green-600',
};

const statusColors: Record<string, string> = {
  'pending': 'bg-slate-600',
  'in_auction': 'bg-yellow-600',
  'sold': 'bg-green-600',
  'unsold': 'bg-red-600',
};

export function PlayerCard({ player }: PlayerCardProps) {
  const [showEdit, setShowEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletePlayer = useMutation(api.players.deletePlayer);

  const canModify = player.auctionStatus === "pending" || player.auctionStatus === "unsold";

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${player.name}? This action cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      await deletePlayer({ id: player._id });
      toast.success('Player deleted successfully');
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to delete player');
    } finally {
      setDeleting(false);
    }
  };
  return (
    <>
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-3 sm:p-4 hover:border-blue-500 transition relative"
    >
      {/* Action Buttons */}
        {canModify && (
          <div className="absolute top-2 right-2 sm:top-3 sm:right-3 flex gap-1.5">
            <button
              onClick={() => setShowEdit(true)}
              className="p-2 sm:p-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition touch-target"
              title="Edit Player"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-2 sm:p-2.5 bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-50 touch-target"
              title="Delete Player"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}

      {/* Player Avatar */}
      <div className="flex items-start gap-2.5 sm:gap-3 mb-3">
        <PlayerAvatar 
          name={player.name} 
          photoUrl={player.photoUrl} 
          size="lg"
        />
        
        <div className="flex-1 min-w-0 pr-16 sm:pr-20">
          <h3 className="font-bold text-base sm:text-lg truncate">{player.name}</h3>
          <p className="text-xs sm:text-sm text-slate-400">{player.age} years</p>
          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-1.5">
            <span className={`px-2 py-0.5 sm:py-1 ${roleColors[player.role]} rounded text-xs font-semibold`}>
              {player.role}
            </span>
            <span className={`px-2 py-0.5 sm:py-1 ${statusColors[player.auctionStatus]} rounded text-xs font-semibold`}>
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

        <div className="flex justify-between">
          <span className="text-slate-400">Base Price</span>
          <span className="font-semibold text-green-400">
            {formatCurrency(player.basePrice)}
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

        {/* Availability */}
        {player.availability.type === 'unavailable' && player.availability.dates && (
          <div className="flex items-start gap-2 pt-2 border-t border-slate-700">
            <Calendar className="w-4 h-4 text-orange-400 mt-0.5" />
            <div>
              <div className="text-xs text-slate-400">Unavailable</div>
              <div className="text-xs text-orange-400">
                {player.availability.dates.length} dates
              </div>
            </div>
          </div>
        )}
      </div>
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