"use client";

import { Doc } from '@/convex/_generated/dataModel';
import { formatCurrency, getPlayerInitials } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Calendar, Edit, Trash2 } from 'lucide-react';
import {PlayerEditForm} from './PlayerEditForm';
import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';

interface PlayerCardProps {
  player: Doc<"players">;
}

const roleColors = {
  'Batter': 'bg-blue-600',
  'Bowler': 'bg-orange-600',
  'All-Rounder': 'bg-purple-600',
};

const statusColors = {
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
      toast.error(error?.message || 'Failed to delete player');
    } finally {
      setDeleting(false);
    }
  };
  return (
    <>
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 hover:border-blue-500 transition"
    >
      {/* Action Buttons */}
        {canModify && (
          <div className="absolute top-2 right-2 flex gap-1">
            <button
              onClick={() => setShowEdit(true)}
              className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
              title="Edit Player"
            >
              <Edit className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-1.5 bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-50"
              title="Delete Player"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

      {/* Player Avatar */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-16 h-16 bg-linear-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center text-xl font-bold shrink-0">
          {getPlayerInitials(player.name)}
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-lg truncate">{player.name}</h3>
          <p className="text-sm text-slate-400">{player.age} years</p>
          <div className="flex gap-2 mt-1">
            <span className={`px-2 py-0.5 ${roleColors[player.role]} rounded text-xs font-semibold`}>
              {player.role}
            </span>
            <span className={`px-2 py-0.5 ${statusColors[player.auctionStatus]} rounded text-xs font-semibold`}>
              {player.auctionStatus}
            </span>
          </div>
        </div>
      </div>

      {/* Player Details */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Batting</span>
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