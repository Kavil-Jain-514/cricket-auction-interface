"use client";

import { motion } from 'framer-motion';
import { Users, Gavel } from 'lucide-react';
import { TeamLogo } from '@/components/ui/team-logo';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

export interface AdminTeamsPanelProps {
  teams: Array<{
    _id: string;
    name: string;
    logoUrl?: string;
    colorPrimary: string;
    purseRemaining: number;
    playerCount?: number;
    maxAllowedBid?: number;
    playersNeeded?: number;
  }>;
  soldPlayers: Array<{ _id: string; teamId?: string }> | undefined;
  currentBidTeamId?: string;
  currentPlayer: { _id: string; name: string; basePrice?: number } | null | undefined;
  auctionRoomStatus: string;
  isFirstBid: boolean;
  minNextBid: number;
  maxPlayersPerTeam: number;
  tournamentBasePrice: number;
  minBidIncrement: number;
  bidding: string | null;
  getCustomBidAmount: (teamId: string, minBid: number) => number;
  setCustomBidAmount: (teamId: string, amount: number) => void;
  onBid: (teamId: string, amount: number) => void;
}

export function AdminTeamsPanel({
  teams,
  soldPlayers,
  currentBidTeamId,
  currentPlayer,
  auctionRoomStatus,
  isFirstBid,
  minNextBid,
  maxPlayersPerTeam,
  tournamentBasePrice,
  minBidIncrement,
  bidding,
  getCustomBidAmount,
  setCustomBidAmount,
  onBid,
}: AdminTeamsPanelProps) {
  return (
    <aside className="col-span-12 lg:col-span-3 order-2 lg:order-2">
      <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2 mb-3 sm:mb-4">
        <Users className="w-4 h-4 sm:w-5 sm:h-5" />
        Teams
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
        {teams?.map((team) => {
          const isCurrentBidder = team._id === currentBidTeamId;
          const teamPlayerCount =
            team.playerCount ??
            (soldPlayers?.filter((p) => p.teamId === team._id).length || 0);
          const hasReachedMaxPlayers = teamPlayerCount >= maxPlayersPerTeam;
          const minBidForTeam = isFirstBid
            ? (currentPlayer?.basePrice ?? tournamentBasePrice)
            : minNextBid;
          const customAmount = getCustomBidAmount(team._id, minBidForTeam);
          const hasSufficientPurse = team.purseRemaining >= customAmount;

          // Check if bid exceeds max allowed for squad completion
          const maxAllowedBid = team.maxAllowedBid ?? team.purseRemaining;
          const exceedsMaxAllowed = customAmount > maxAllowedBid;

          const isValidBid =
            customAmount >= minBidForTeam &&
            customAmount <= team.purseRemaining &&
            !exceedsMaxAllowed;
          const canBid =
            hasSufficientPurse &&
            !hasReachedMaxPlayers &&
            isValidBid &&
            !!currentPlayer &&
            auctionRoomStatus === 'live';

          // Determine the error message
          let bidError: string | null = null;
          if (hasReachedMaxPlayers) {
            bidError = 'Squad full';
          } else if (exceedsMaxAllowed && team.playersNeeded && team.playersNeeded > 1) {
            bidError = `Max bid: ${formatCurrency(maxAllowedBid)} (need ${team.playersNeeded} more players)`;
          } else if (!hasSufficientPurse) {
            bidError = 'Insufficient purse';
          }

          return (
            <motion.div
              key={team._id}
              onClick={() => {
                if (canBid) {
                  onBid(team._id, customAmount);
                } else if (bidError) {
                  toast.error(bidError);
                }
              }}
              className={`
                relative rounded-xl p-2.5 sm:p-3 border-2 transition-all
                ${canBid ? 'cursor-pointer hover:border-blue-500 hover:bg-slate-700/50 active:scale-[0.98]' : 'cursor-not-allowed'}
                ${
                  isCurrentBidder
                    ? 'border-yellow-500 bg-yellow-500/10 shadow-lg shadow-yellow-500/20'
                    : 'border-slate-700 bg-slate-800/50'
                }
                ${hasReachedMaxPlayers || exceedsMaxAllowed ? 'opacity-50' : ''}
              `}
            >
              {bidding === team._id && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl z-10">
                  <div className="animate-spin rounded-full h-5 w-5 sm:h-6 sm:w-6 border-b-2 border-white" />
                </div>
              )}

              <div className="flex items-center gap-2 mb-2">
                {/* Team Logo */}
                <TeamLogo
                  name={team.name}
                  logoUrl={team.logoUrl}
                  primaryColor={team.colorPrimary}
                  size="sm"
                />

                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-xs sm:text-sm truncate block">
                    {team.name}
                  </span>
                </div>

                {isCurrentBidder && (
                  <Gavel className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-yellow-500 animate-pulse shrink-0" />
                )}
              </div>

              {/* Custom Bid Input */}
              {currentPlayer && !hasReachedMaxPlayers && (
                <div
                  className="relative"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
                  <Input
                    type="number"
                    min={minBidForTeam}
                    max={maxAllowedBid}
                    step={minBidIncrement}
                    value={customAmount}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || minBidForTeam;
                      setCustomBidAmount(team._id, value);
                    }}
                    className={`pl-6 pr-2 py-1 h-8 text-xs bg-slate-900 border-slate-600 text-white w-full ${exceedsMaxAllowed ? 'border-red-500' : ''}`}
                    disabled={!currentPlayer || hasReachedMaxPlayers}
                  />
                </div>
              )}

              {/* Validation Messages */}
              {currentPlayer && !hasReachedMaxPlayers && customAmount > 0 && (
                <div className="mt-1">
                  {customAmount < minBidForTeam && (
                    <p className="text-[10px] text-red-400">Min: {formatCurrency(minBidForTeam)}</p>
                  )}
                  {exceedsMaxAllowed && team.playersNeeded && team.playersNeeded > 1 && (
                    <p className="text-[10px] text-red-400">
                      Max: {formatCurrency(maxAllowedBid)} (need {team.playersNeeded} players)
                    </p>
                  )}
                  {!exceedsMaxAllowed && customAmount > team.purseRemaining && (
                    <p className="text-[10px] text-red-400">Exceeds purse limit</p>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </aside>
  );
}
