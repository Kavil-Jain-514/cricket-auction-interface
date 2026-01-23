"use client";

import { Doc, Id } from '@/convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Users, DollarSign, Trophy } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { motion } from 'framer-motion';

interface TeamCardProps {
  team: Doc<"teams">;
  tournamentId: Id<"tournaments">;
}

export function TeamCard({ team, tournamentId }: TeamCardProps) {
  const players = useQuery(api.players.listByTournament, { 
    tournamentId,
  });

  const teamPlayers = players?.filter(p => p.teamId === team._id) || [];
  const pursePercentage = (team.purseRemaining / (team.purseRemaining + team.purseSpent)) * 100;

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-blue-500 transition"
    >
      {/* Team Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div 
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: team.colorPrimary }}
            />
            <h3 className="text-xl font-bold">{team.name}</h3>
          </div>
          <p className="text-sm text-slate-400">Owner: {team.ownerName}</p>
          {team.sponsorName && (
            <p className="text-xs text-slate-500">Sponsor: {team.sponsorName}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="space-y-4 mb-4">
        {/* Purse */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-400">Purse Remaining</span>
            <span className="font-semibold text-green-400">
              {formatCurrency(team.purseRemaining)}
            </span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <motion.div
              className="h-2 rounded-full"
              style={{ backgroundColor: team.colorPrimary }}
              initial={{ width: 0 }}
              animate={{ width: `${pursePercentage}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>Spent: {formatCurrency(team.purseSpent)}</span>
            <span>{pursePercentage.toFixed(0)}%</span>
          </div>
        </div>

        {/* Players Count */}
        <div className="flex items-center justify-between py-3 px-4 bg-slate-900/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-slate-400">Players</span>
          </div>
          <span className="font-semibold">{teamPlayers.length}</span>
        </div>

        {/* Top Players */}
        {teamPlayers.length > 0 && (
          <div>
            <div className="text-xs text-slate-400 mb-2">Top Purchases</div>
            <div className="space-y-1">
              {teamPlayers
                .sort((a, b) => (b.soldPrice || 0) - (a.soldPrice || 0))
                .slice(0, 3)
                .map((player) => (
                  <div 
                    key={player._id}
                    className="flex justify-between text-xs py-1"
                  >
                    <span className="text-slate-300 truncate">{player.name}</span>
                    <span className="text-yellow-400 font-semibold">
                      {formatCurrency(player.soldPrice || 0)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="pt-4 border-t border-slate-700 flex items-center justify-between text-xs text-slate-400">
        <span>Updated {new Date(team.updatedAt).toLocaleDateString()}</span>
        <button className="text-blue-400 hover:underline">View Details</button>
      </div>
    </motion.div>
  );
}