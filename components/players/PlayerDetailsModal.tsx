"use client";

import { Doc } from '@/convex/_generated/dataModel';
import { formatCurrency } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  User,
  Shirt,
  Phone,
  IndianRupee,
  Trophy
} from 'lucide-react';
import { PlayerAvatar } from '@/components/ui/player-avatar';

interface PlayerDetailsModalProps {
  player: Doc<"players">;
  teamName?: string;
  onClose: () => void;
}

const roleColors: Record<string, { bg: string; text: string; border: string }> = {
  'Batter': { bg: 'bg-blue-600/20', text: 'text-blue-400', border: 'border-blue-500' },
  'Bowler': { bg: 'bg-orange-600/20', text: 'text-orange-400', border: 'border-orange-500' },
  'All-Rounder': { bg: 'bg-purple-600/20', text: 'text-purple-400', border: 'border-purple-500' },
  'All Rounder': { bg: 'bg-purple-600/20', text: 'text-purple-400', border: 'border-purple-500' },
  'Wicket-Keeper': { bg: 'bg-green-600/20', text: 'text-green-400', border: 'border-green-500' },
};

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  'pending': { bg: 'bg-slate-600/20', text: 'text-slate-400', label: 'Pending' },
  'in_auction': { bg: 'bg-yellow-600/20', text: 'text-yellow-400', label: 'In Auction' },
  'sold': { bg: 'bg-green-600/20', text: 'text-green-400', label: 'Sold' },
  'unsold': { bg: 'bg-red-600/20', text: 'text-red-400', label: 'Unsold' },
};

export function PlayerDetailsModal({
  player,
  teamName,
  onClose
}: PlayerDetailsModalProps) {
  const roleStyle = roleColors[player.role] || roleColors['Batter'];
  const statusStyle = statusConfig[player.auctionStatus] || statusConfig['pending'];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full overflow-hidden my-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with gradient */}
          <div className={`relative h-28 sm:h-32 bg-linear-to-br ${player.role === 'Batter' ? 'from-blue-600 to-blue-800' :
              player.role === 'Bowler' ? 'from-orange-600 to-orange-800' :
                player.role.includes('All') ? 'from-purple-600 to-purple-800' :
                  'from-green-600 to-green-800'
            }`}>
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-2 bg-black/30 hover:bg-black/50 rounded-full transition"
            >
              <X className="w-5 h-5 text-white" />
            </button>

            {/* Player avatar positioned at bottom of header */}
            <div className="absolute -bottom-12 left-1/2 -translate-x-1/2">
              <div className="p-1.5 bg-slate-900 rounded-2xl">
                <PlayerAvatar
                  name={player.name}
                  photoUrl={player.photoUrl}
                  size="2xl"
                  className="w-24! h-24! sm:w-28! sm:h-28!"
                />
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="pt-16 pb-6 px-5 sm:px-6">
            {/* Name and Role */}
            <div className="text-center mb-6">
              <h2 className="text-2xl sm:text-3xl font-bold mb-2">{player.name}</h2>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${roleStyle.bg} ${roleStyle.text} border ${roleStyle.border}`}>
                  {player.role}
                </span>
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
                  {statusStyle.label}
                </span>
              </div>
            </div>

            {/* Details Grid */}
            <div className="space-y-4">
              {/* Personal Details */}
              <div className="bg-slate-800/50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Personal Details
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-slate-500">Age</span>
                    <p className="font-semibold">{player.age} years</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Style</span>
                    <p className="font-semibold">{player.battingBowlingHand}</p>
                  </div>
                  {player.phoneNumber && (
                    <div className="col-span-2">
                      <span className="text-slate-500 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> Phone
                      </span>
                      <p className="font-semibold">{player.phoneNumber}</p>
                    </div>
                  )}
                  {player.tshirtSize && (
                    <div>
                      <span className="text-slate-500 flex items-center gap-1">
                        <Shirt className="w-3 h-3" /> T-Shirt
                      </span>
                      <p className="font-semibold">{player.tshirtSize}</p>
                    </div>
                  )}
                  {player.jerseyNumber && (
                    <div>
                      <span className="text-slate-500">Jersey</span>
                      <p className="font-semibold">#{player.jerseyNumber}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Auction Details */}
              <div className="bg-slate-800/50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
                  <IndianRupee className="w-4 h-4" />
                  Auction Details
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between py-2 border-b border-slate-700">
                    <span className="text-slate-400">Base Price</span>
                    <span className="font-semibold text-white">
                      {formatCurrency(player.basePrice ?? 100000)}
                    </span>
                  </div>
                  {player.soldPrice && (
                    <div>
                      <span className="text-slate-500">Sold Price</span>
                      <p className="font-semibold text-yellow-400 text-lg">
                        {formatCurrency(player.soldPrice)}
                      </p>
                    </div>
                  )}
                  {teamName && (
                    <div className="col-span-2">
                      <span className="text-slate-500">Team</span>
                      <p className="font-semibold text-blue-400">{teamName}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Statistics */}
              {player.stats && (player.stats.matches || player.stats.runs || player.stats.wickets) && (
                <div className="bg-slate-800/50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
                    <Trophy className="w-4 h-4" />
                    Career Statistics
                  </h3>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {player.stats.matches !== undefined && (
                      <div className="bg-slate-700/50 rounded-lg p-2">
                        <p className="text-lg font-bold">{player.stats.matches}</p>
                        <span className="text-xs text-slate-400">Matches</span>
                      </div>
                    )}
                    {player.stats.runs !== undefined && (
                      <div className="bg-slate-700/50 rounded-lg p-2">
                        <p className="text-lg font-bold text-blue-400">{player.stats.runs}</p>
                        <span className="text-xs text-slate-400">Runs</span>
                      </div>
                    )}
                    {player.stats.wickets !== undefined && (
                      <div className="bg-slate-700/50 rounded-lg p-2">
                        <p className="text-lg font-bold text-orange-400">{player.stats.wickets}</p>
                        <span className="text-xs text-slate-400">Wickets</span>
                      </div>
                    )}
                    {player.stats.average !== undefined && (
                      <div className="bg-slate-700/50 rounded-lg p-2">
                        <p className="text-lg font-bold text-green-400">{player.stats.average.toFixed(1)}</p>
                        <span className="text-xs text-slate-400">Average</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}