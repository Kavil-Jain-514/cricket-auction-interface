"use client";

import { Doc, Id } from '@/convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Users, Download } from 'lucide-react';
import { useState } from 'react';
import { formatCurrency, getErrorMessage } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Trash2, Edit } from 'lucide-react';
import { TeamEditForm } from './TeamEditForm';
import { TeamDetailsModal } from './TeamDetailsModal';
import { useMutation } from 'convex/react';
import { toast } from 'sonner';
import { TeamLogo } from '@/components/ui/team-logo';
import { generateTeamPdf } from '@/lib/generateTeamPdf';
import { useUserRole } from '@/hooks/useUserRole';

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
  const { isAdmin } = useUserRole();

  // Check if can edit/delete (admin only, not for completed tournaments)
  const canModify = isAdmin && tournament && tournament.status !== "completed";

  const handleDownloadPdf = async () => {
    toast.info('Generating PDF...');
    try {
      await generateTeamPdf({
        name: team.name,
        ownerName: team.ownerName,
        sponsorName: team.sponsorName,
        colorPrimary: team.colorPrimary,
        colorSecondary: team.colorSecondary,
        purseRemaining: team.purseRemaining,
        purseSpent: team.purseSpent,
        captainName: team.captainName,
        captainAge: team.captainAge,
        captainRole: team.captainRole,
        captainHand: team.captainHand,
        players: teamPlayers.map(p => ({
          name: p.name,
          role: Array.isArray(p.role) ? p.role.join(", ") : p.role,
          soldPrice: p.soldPrice,
          jerseyNumber: p.jerseyNumber,
          jerseyName: p.jerseyName,
          battingBowlingHand: p.battingBowlingHand,
          phoneNumber: (p as Record<string, unknown>).phoneNumber as string | undefined,
          tshirtSize: p.tshirtSize,
        })),
        tournamentName: tournament?.name,
        logoUrl: team.logoUrl,
      });
      toast.success('PDF downloaded successfully');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to generate PDF'));
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${team.name}? This action cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      await deleteTeam({ id: team._id });
      toast.success('Team deleted successfully');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete team'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <motion.div
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setShowDetails(true)}
        className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 sm:p-5 lg:p-6 hover:border-blue-500 transition relative cursor-pointer"
      >
        {(canModify || tournament?.status === "completed") && (
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex gap-1.5 sm:gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); handleDownloadPdf(); }}
              className="p-2 sm:p-2.5 bg-green-600 hover:bg-green-700 rounded-lg transition touch-target"
              title="Download PDF"
            >
              <Download className="w-6 h-4" />
            </button>
            {canModify && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowEdit(true); }}
                  className="p-2 sm:p-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition touch-target"
                  title="Edit Team"
                >
                  <Edit className="w-6 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                  disabled={deleting}
                  className="p-2 sm:p-2.5 bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-50 touch-target"
                  title="Delete Team"
                >
                  <Trash2 className="w-6 h-4" />
                </button>
              </>
            )}
          </div>
        )}
        {/* Team Header */}
        <div className="flex items-start justify-between mb-3 sm:mb-4">
          <div className="flex items-center gap-2.5 sm:gap-3 flex-1 pr-24 sm:pr-32">
            {/* Team Logo */}
            <TeamLogo
              name={team.name}
              logoUrl={team.logoUrl}
              primaryColor={team.colorPrimary}
              size="md"
            />
            <div className="min-w-0">
              <h3 className="text-lg sm:text-xl font-bold truncate">{team.name}</h3>
              <p className="text-xs sm:text-sm text-slate-400 truncate">Owner: {team.ownerName}</p>
              {team.sponsorName && (
                <p className="text-xs text-slate-500 truncate">Sponsor: {team.sponsorName}</p>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-3 sm:space-y-4 mb-3 sm:mb-4">
          {/* Purse */}
          <div>
            <div className="flex justify-between text-xs sm:text-sm mb-2">
              <span className="text-slate-400">Purse Remaining</span>
              <span className="font-semibold text-green-400">
                {formatCurrency(team.purseRemaining)}
              </span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2 sm:h-2.5">
              <motion.div
                className="h-2 sm:h-2.5 rounded-full"
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
          <div className="flex items-center justify-between py-2.5 sm:py-3 px-3 sm:px-4 bg-slate-900/50 rounded-lg">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-400" />
              <span className="text-xs sm:text-sm text-slate-400">Players</span>
            </div>
            <span className="font-semibold text-sm sm:text-base">{teamPlayers.length}</span>
          </div>

          {/* Top Players */}
          {teamPlayers.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-2">Top Purchases</div>
              <div className="space-y-1.5">
                {teamPlayers
                  .sort((a, b) => (b.soldPrice || 0) - (a.soldPrice || 0))
                  .slice(0, 3)
                  .map((player) => (
                    <div
                      key={player._id}
                      className="flex justify-between text-xs sm:text-sm py-1"
                    >
                      <span className="text-slate-300 truncate mr-2">{player.name}</span>
                      <span className="text-yellow-400 font-semibold whitespace-nowrap">
                        {formatCurrency(player.soldPrice || 0)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 sm:pt-4 border-t border-slate-700 flex items-center justify-between text-xs text-slate-400">
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