"use client";

import { Doc } from '@/convex/_generated/dataModel';
import { formatCurrency, getPlayerInitials } from '@/lib/utils';
import { motion } from 'framer-motion';
import { TrendingUp, Calendar } from 'lucide-react';

interface PlayerCardProps {
  player: Doc<"players">;
}

const roleColors = {
  'Batter': 'bg-blue-600',
  'Bowler': 'bg-red-600',
  'All-Rounder': 'bg-purple-600',
};

const statusColors = {
  'pending': 'bg-slate-600',
  'in_auction': 'bg-yellow-600',
  'sold': 'bg-green-600',
  'unsold': 'bg-red-600',
};

export function PlayerCard({ player }: PlayerCardProps) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 hover:border-blue-500 transition"
    >
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
          <span className="font-semibold">{player.battingBowlingHand}-handed</span>
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

        {/* Stats */}
        {player.stats && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-700">
            {player.stats.matches && (
              <div>
                <div className="text-xs text-slate-400">Matches</div>
                <div className="font-semibold">{player.stats.matches}</div>
              </div>
            )}
            {player.stats.runs && (
              <div>
                <div className="text-xs text-slate-400">Runs</div>
                <div className="font-semibold text-green-400">{player.stats.runs}</div>
              </div>
            )}
            {player.stats.wickets && (
              <div>
                <div className="text-xs text-slate-400">Wickets</div>
                <div className="font-semibold text-red-400">{player.stats.wickets}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}