"use client";

import { Doc, Id } from '@/convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { formatCurrency } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Trash2, Eye, Edit } from 'lucide-react';
import { TeamEditForm } from './TeamEditForm';
import { TeamDetailsModal } from './TeamDetailsModal';
import { useMutation } from 'convex/react';
import { toast } from 'sonner';

interface TeamCardProps {
  team: Doc<"teams">;
  tournamentId: Id<"tournaments">;
}

export function TeamCard({ team, tournamentId }: TeamCardProps) {
  const [showEdit, setShowEdit] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const players = useQuery(api.players.listByTournament, { 
    tournamentId,
  });
  const deleteTeam = useMutation(api.teams.deleteTeam);
  const teamPlayers = players?.filter(p => p.teamId === team._id) || [];
  const pursePercentage = (team.purseRemaining / (team.purseRemaining + team.purseSpent)) * 100;

  // Check if can edit/delete (not during active auction)
  const canModify = tournament && tournament.status !== "active" && tournament.status !== "completed";

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${team.name}? This action cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      await deleteTeam({ id: team._id });
      toast.success('Team deleted successfully');
    } catch (error) {
      toast.error(error?.message || 'Failed to delete team');
    } finally {
      setDeleting(false);
    }
  };

  return (
   <> 
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-blue-500 transition"
    >
      {canModify && (
          <div className="absolute top-4 right-4 flex gap-2">
            <button
              onClick={() => setShowDetails(true)}
              className="p-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
              title="View Details"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowEdit(true)}
              className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
              title="Edit Team"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-2 bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-50"
              title="Delete Team"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      
      {!canModify && (
          <div className="absolute top-4 right-4">
            <button
              onClick={() => setShowDetails(true)}
              className="p-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
              title="View Details"
            >
              <Eye className="w-4 h-4" />
            </button>
          </div>
        )}
      {/* Team Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 flex-1">
          {/* Team Logo */}
          {team.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img 
              src={team.logoUrl} 
              alt={`${team.name} logo`}
              className="w-12 h-12 rounded-lg object-cover border border-slate-600"
            />
          ) : (
            <div 
              className="w-12 h-12 rounded-lg flex items-center justify-center text-xl font-bold"
              style={{ backgroundColor: team.colorPrimary }}
            >
              {team.name.charAt(0)}
            </div>
          )}
          <div>
            <h3 className="text-xl font-bold">{team.name}</h3>
            <p className="text-sm text-slate-400">Owner: {team.ownerName}</p>
            {team.sponsorName && (
              <p className="text-xs text-slate-500">Sponsor: {team.sponsorName}</p>
            )}
          </div>
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
      </div>
    </motion.div>
    {/* Modals */}
      {showEdit && (
        <TeamEditForm
          team={team}
          onClose={() => setShowEdit(false)}
          onSuccess={() => setShowEdit(false)}
        />
      )}

      {showDetails && (
        <TeamDetailsModal
          teamId={team._id}
          onClose={() => setShowDetails(false)}
        />
      )}
    </>

  );
}