"use client";

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { X, Users, TrendingUp, Award, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency, getPlayerInitials } from '@/lib/utils';
import { motion } from 'framer-motion';

interface TeamDetailsModalProps {
  teamId: Id<"teams">;
  onClose: () => void;
}

const roleColors = {
  'Batter': 'bg-blue-600',
  'Bowler': 'bg-red-600',
  'All-Rounder': 'bg-purple-600',
};

export function TeamDetailsModal({ teamId, onClose }: TeamDetailsModalProps) {
  const teamData = useQuery(api.teams.getWithPlayers, { id: teamId });

  if (!teamData) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  const { players, ...team } = teamData;
  const pursePercentage = (team.purseRemaining / (team.purseRemaining + team.purseSpent)) * 100;

  // Calculate team composition
  const composition = {
    batters: players.filter(p => p.role === 'Batter').length,
    bowlers: players.filter(p => p.role === 'Bowler').length,
    allRounders: players.filter(p => p.role === 'All-Rounder').length,
  };

  // Get top 3 most expensive players
  const topPlayers = [...players]
    .sort((a, b) => (b.soldPrice || 0) - (a.soldPrice || 0))
    .slice(0, 3);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 border border-slate-700 rounded-xl max-w-5xl w-full p-6 my-8"
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div 
              className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold"
              style={{ 
                background: `linear-gradient(135deg, ${team.colorPrimary}, ${team.colorSecondary})` 
              }}
            >
              {team.name.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-3xl font-bold">{team.name}</h2>
              <p className="text-slate-400">Owner: {team.ownerName}</p>
              {team.sponsorName && (
                <p className="text-sm text-slate-500">Sponsor: {team.sponsorName}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-slate-400">Squad Size</span>
            </div>
            <div className="text-2xl font-bold">{players.length}</div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-sm text-slate-400">Purse Left</span>
            </div>
            <div className="text-2xl font-bold text-green-400">
              {formatCurrency(team.purseRemaining)}
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingBag className="w-4 h-4 text-orange-400" />
              <span className="text-sm text-slate-400">Total Spent</span>
            </div>
            <div className="text-2xl font-bold text-orange-400">
              {formatCurrency(team.purseSpent)}
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Award className="w-4 h-4 text-yellow-400" />
              <span className="text-sm text-slate-400">Avg Price</span>
            </div>
            <div className="text-2xl font-bold text-yellow-400">
              {players.length > 0 ? formatCurrency(team.purseSpent / players.length) : '₹0'}
            </div>
          </div>
        </div>

        {/* Purse Bar */}
        <div className="mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-400">Budget Utilization</span>
            <span className="font-semibold">{(100 - pursePercentage).toFixed(1)}% Used</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-3">
            <motion.div
              className="h-3 rounded-full"
              style={{ background: `linear-gradient(90deg, ${team.colorPrimary}, ${team.colorSecondary})` }}
              initial={{ width: 0 }}
              animate={{ width: `${100 - pursePercentage}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Team Composition */}
        <div className="mb-6">
          <h3 className="text-lg font-bold mb-3">Team Composition</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-600/10 border border-blue-600/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-400">{composition.batters}</div>
              <div className="text-xs text-slate-400">Batters</div>
            </div>
            <div className="bg-red-600/10 border border-red-600/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{composition.bowlers}</div>
              <div className="text-xs text-slate-400">Bowlers</div>
            </div>
            <div className="bg-purple-600/10 border border-purple-600/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-purple-400">{composition.allRounders}</div>
              <div className="text-xs text-slate-400">All-Rounders</div>
            </div>
            <div className="bg-green-600/10 border border-green-600/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{composition.keepers}</div>
              <div className="text-xs text-slate-400">Keepers</div>
            </div>
          </div>
        </div>

        {/* Top Purchases */}
        {topPlayers.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-bold mb-3">Top Purchases</h3>
            <div className="space-y-2">
              {topPlayers.map((player, idx) => (
                <div 
                  key={player._id}
                  className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-linear-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center text-sm font-bold">
                      {getPlayerInitials(player.name)}
                    </div>
                    <div>
                      <div className="font-semibold">{player.name}</div>
                      <div className="text-xs text-slate-400">{player.role}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-yellow-400">
                      {formatCurrency(player.soldPrice || 0)}
                    </div>
                    <div className="text-xs text-slate-400">#{idx + 1} Purchase</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Full Squad */}
        <div>
          <h3 className="text-lg font-bold mb-3">Full Squad ({players.length} Players)</h3>
          {players.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No players in squad yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
              {players.map((player) => (
                <div 
                  key={player._id}
                  className="bg-slate-800/30 border border-slate-700 rounded-lg p-3 hover:bg-slate-800/50 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-linear-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center font-bold">
                      {getPlayerInitials(player.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{player.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`px-2 py-0.5 ${roleColors[player.role]} rounded text-xs font-semibold`}>
                          {player.role}
                        </span>
                        <span className="text-xs text-slate-400">{player.age}y</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-green-400">
                        {formatCurrency(player.soldPrice || 0)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Close Button */}
        <div className="mt-6 flex justify-end">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </div>
      </motion.div>
    </div>
  );
}