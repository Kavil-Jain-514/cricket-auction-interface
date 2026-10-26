"use client";

import { motion } from 'framer-motion';
import { Trophy, Crown, Star, Medal, TrendingUp } from 'lucide-react';
import confetti from 'canvas-confetti';
import { useEffect, useState } from 'react';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { formatCurrency, getRoleDisplay } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { TeamLogo } from '@/components/ui/team-logo';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { ShareResultsButton } from '@/components/results/ShareResultsButton';
import { ExportResultsButton } from '@/components/results/ExportResultsButton';
import type { Id } from '@/convex/_generated/dataModel';

interface SoldPlayer {
  _id: string;
  name: string;
  role: string | string[];
  soldPrice: number;
  teamId: string;
  photoUrl?: string;
}

interface Team {
  _id: string;
  name: string;
  colorPrimary: string;
  logoUrl?: string;
  purseSpent: number;
  purseRemaining: number;
}

interface AuctionCompleteScreenProps {
  tournamentName: string;
  tournamentId: string;
  tournamentLogoUrl?: string;
  soldPlayers: SoldPlayer[];
  teams: Team[];
  stats: {
    total: number;
    sold: number;
    unsold: number;
  };
  /** Shows "Export results (.xlsx)". */
  isAdmin?: boolean;
}

export function AuctionCompleteScreen({
  tournamentName,
  tournamentId,
  tournamentLogoUrl,
  soldPlayers,
  teams,
  stats,
  isAdmin = false,
}: AuctionCompleteScreenProps) {
  const [showSummary, setShowSummary] = useState(false);

  // Get top 10 buys sorted by price
  const top10Buys = [...soldPlayers]
    .sort((a, b) => b.soldPrice - a.soldPrice)
    .slice(0, 10);

  const getTeamById = (teamId: string) => teams.find(t => t._id === teamId);
  useEffect(() => {
    const duration = 5000;
    const end = Date.now() + duration;

    const colors = ['#FFD700', '#FFA500', '#FF6347', '#00CED1', '#9370DB'];

    const frame = () => {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 80,
        origin: { x: 0, y: 0.6 },
        colors,
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 80,
        origin: { x: 1, y: 0.6 },
        colors,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };

    frame();

    // Show summary after initial celebration
    const timer = setTimeout(() => setShowSummary(true), 2000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-purple-950 to-slate-950 text-white overflow-auto">
      {/* Celebration Header */}
      <motion.div
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-12 relative"
      >
        <motion.div
          animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="inline-block mb-6"
        >
          <Trophy className="w-32 h-32 text-yellow-500 mx-auto" />
        </motion.div>

        <motion.h1
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, delay: 0.3 }}
          className="text-6xl md:text-8xl font-bold mb-4 text-transparent bg-clip-text bg-linear-to-r from-yellow-400 via-orange-500 to-red-500"
        >
          AUCTION COMPLETE!
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex items-center justify-center gap-4"
        >
          <ImgWithFallback
            src={tournamentLogoUrl}
            alt={tournamentName}
            className="w-12 h-12 md:w-16 md:h-16 rounded-xl object-cover border-2 border-yellow-500/50"
            fallback={
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                <Trophy className="w-6 h-6 md:w-8 md:h-8 text-yellow-500" />
              </div>
            }
          />
          <p className="text-2xl md:text-3xl text-slate-300 font-semibold">
            {tournamentName}
          </p>
        </motion.div>

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="flex justify-center gap-8 mt-8"
        >
          <div className="text-center">
            <div className="text-4xl font-bold text-green-400">{stats.sold}</div>
            <div className="text-sm text-slate-400">Players Sold</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-red-400">{stats.unsold}</div>
            <div className="text-sm text-slate-400">Unsold</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-blue-400">{stats.total}</div>
            <div className="text-sm text-slate-400">Total Players</div>
          </div>
        </motion.div>
      </motion.div>

      {/* Summary Section */}
      {showSummary && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-6xl mx-auto px-6 pb-12"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Top 10 Buys */}
            <motion.div
              initial={{ x: -50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="bg-slate-900/80 backdrop-blur rounded-2xl p-6 border border-slate-700"
            >
              <div className="flex items-center gap-3 mb-6">
                <Crown className="w-8 h-8 text-yellow-500" />
                <h2 className="text-2xl font-bold">Top 10 Buys</h2>
              </div>

              <div className="space-y-3">
                {top10Buys.map((player, index) => {
                  const team = getTeamById(player.teamId);
                  return (
                    <motion.div
                      key={player._id}
                      initial={{ x: -20, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: 0.3 + index * 0.1 }}
                      className="flex items-center gap-4 p-3 bg-slate-800/50 rounded-xl"
                    >
                      <div className={`
                        w-8 h-8 rounded-full flex items-center justify-center font-bold
                        ${index === 0 ? 'bg-yellow-500 text-black' :
                          index === 1 ? 'bg-slate-300 text-black' :
                            index === 2 ? 'bg-orange-600 text-white' :
                              'bg-slate-700 text-white'}
                      `}>
                        {index + 1}
                      </div>

                      <PlayerAvatar
                        name={player.name}
                        photoUrl={player.photoUrl}
                        size="sm"
                      />

                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{player.name}</p>
                        <p className="text-sm text-slate-400">{getRoleDisplay(player.role)}</p>
                      </div>

                      <div className="text-right">
                        <p className="font-bold text-yellow-400">
                          {formatCurrency(player.soldPrice)}
                        </p>
                        <p
                          className="text-sm font-medium"
                          style={{ color: team?.colorPrimary || '#94a3b8' }}
                        >
                          {team?.name || 'Unknown'}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}

                {top10Buys.length === 0 && (
                  <p className="text-center text-slate-400 py-8">No players were sold</p>
                )}
              </div>
            </motion.div>

            {/* Team Summary */}
            <motion.div
              initial={{ x: 50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="bg-slate-900/80 backdrop-blur rounded-2xl p-6 border border-slate-700"
            >
              <div className="flex items-center gap-3 mb-6">
                <TrendingUp className="w-8 h-8 text-green-500" />
                <h2 className="text-2xl font-bold">Team Spending</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...teams]
                  .sort((a, b) => b.purseSpent - a.purseSpent)
                  .map((team, index) => {
                    const playersCount = soldPlayers.filter(p => p.teamId === team._id).length;
                    return (
                      <motion.div
                        key={team._id}
                        initial={{ x: 20, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: 0.3 + index * 0.1 }}
                        className="p-3 bg-slate-800/50 rounded-xl"
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <TeamLogo
                            name={team.name}
                            logoUrl={team.logoUrl}
                            primaryColor={team.colorPrimary}
                            size="md"
                          />
                          <div className="flex-1">
                            <p className="font-semibold">{team.name}</p>
                            <p className="text-sm text-slate-400">{playersCount} players</p>
                          </div>
                          {index === 0 && (
                            <Medal className="w-6 h-6 text-yellow-500" />
                          )}
                        </div>

                        <div className="flex justify-between text-sm mt-2">
                          <span className="text-slate-400">Spent</span>
                          <span className="font-semibold text-red-400">
                            {formatCurrency(team.purseSpent)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Remaining</span>
                          <span className="font-semibold text-green-400">
                            {formatCurrency(team.purseRemaining)}
                          </span>
                        </div>

                        {/* Spending bar */}
                        <div className="w-full bg-slate-700 rounded-full h-2 mt-2">
                          <div
                            className="h-2 rounded-full transition-all"
                            style={{
                              width: `${(team.purseSpent / (team.purseSpent + team.purseRemaining)) * 100}%`,
                              backgroundColor: team.colorPrimary,
                            }}
                          />
                        </div>
                      </motion.div>
                    );
                  })}
              </div>
            </motion.div>
          </div>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1 }}
            className="flex flex-wrap justify-center gap-4 mt-8"
          >
            {tournamentId && (
              <ShareResultsButton
                tournamentId={tournamentId}
                tournamentName={tournamentName}
                className="h-11 px-5 border-slate-500 bg-slate-800 text-slate-100 hover:bg-slate-700 hover:text-white"
              />
            )}
            {isAdmin && tournamentId && (
              <ExportResultsButton tournamentId={tournamentId as Id<"tournaments">} />
            )}
            <Link href={`/tournament/${tournamentId}`}>
              <Button size="lg" variant="outline">
                Back to Tournament
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="lg" className="bg-linear-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600">
                <Star className="w-5 h-5 mr-2" />
                Dashboard
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
