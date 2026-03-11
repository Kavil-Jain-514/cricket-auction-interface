"use client";

import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrency, getRoleDisplay } from '@/lib/utils';

export interface PlayerIntroFlashProps {
  show: boolean;
  player: {
    name: string;
    photoUrl?: string | null;
    playerNumber?: number | null;
    role: string | string[];
    age?: number;
    battingBowlingHand?: string;
    basePrice?: number;
  };
  tournamentBasePrice: number;
}

export function PlayerIntroFlash({ show, player, tournamentBasePrice }: PlayerIntroFlashProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-100 bg-linear-to-br from-slate-950 via-purple-950 to-slate-950 flex items-center justify-center"
        >
          {/* Animated background elements */}
          <div className="absolute inset-0 overflow-hidden">
            <motion.div
              className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl"
              animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <motion.div
              className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl"
              animate={{ scale: [1.2, 1, 1.2], opacity: [0.5, 0.3, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </div>

          <motion.div
            initial={{ scale: 0.8, y: 50 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.8, y: -50 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="relative z-10 text-center px-6"
          >
            {/* Player Photo */}
            <motion.div
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.1, duration: 0.4, type: "spring" }}
              className="mb-6 sm:mb-8"
            >
              <div className="relative inline-block">
                <div className="w-48 h-48 sm:w-64 sm:h-64 lg:w-80 lg:h-80 rounded-2xl overflow-hidden border-4 border-purple-500 shadow-2xl shadow-purple-500/30 mx-auto">
                  {player.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={player.photoUrl}
                      alt={player.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-linear-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                      <span className="text-7xl sm:text-8xl lg:text-9xl font-bold text-white">
                        {player.name.charAt(0)}
                      </span>
                    </div>
                  )}
                </div>
                {/* Glow effect */}
                <div className="absolute inset-0 rounded-2xl bg-purple-500/20 blur-xl -z-10 scale-110" />
              </div>
            </motion.div>

            {/* Player Number Badge */}
            {player.playerNumber && (
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15, duration: 0.3 }}
                className="mb-4"
              >
                <span className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-blue-600 text-white text-2xl sm:text-3xl font-bold shadow-lg shadow-blue-500/30">
                  #{player.playerNumber}
                </span>
              </motion.div>
            )}

            {/* Player Name */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4 sm:mb-6"
            >
              {player.name}
            </motion.h1>

            {/* Player Details */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.3 }}
              className="flex flex-wrap justify-center gap-3 sm:gap-4 mb-6 sm:mb-8"
            >
              <span className="px-4 sm:px-6 py-2 sm:py-3 bg-purple-600 rounded-full text-sm sm:text-lg font-semibold text-white shadow-lg">
                {getRoleDisplay(player.role)}
              </span>
              <span className="px-4 sm:px-6 py-2 sm:py-3 bg-slate-700 rounded-full text-sm sm:text-lg text-white shadow-lg">
                {player.age != null ? `${player.age} years` : '-'}
              </span>
              <span className="px-4 sm:px-6 py-2 sm:py-3 bg-slate-700 rounded-full text-sm sm:text-lg text-white shadow-lg">
                {player.battingBowlingHand ?? '-'}
              </span>
            </motion.div>

            {/* Base Price */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="inline-block"
            >
              <div className="px-6 sm:px-8 py-3 sm:py-4 bg-linear-to-r from-yellow-500 to-orange-500 rounded-xl shadow-lg shadow-orange-500/30">
                <div className="text-xs sm:text-sm font-semibold text-white/80 mb-1">BASE PRICE</div>
                <div className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">
                  {formatCurrency(player.basePrice ?? tournamentBasePrice)}
                </div>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
