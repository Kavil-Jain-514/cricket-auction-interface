"use client";

import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, XCircle, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import { useEffect } from 'react';
import { formatCurrency } from '@/lib/utils';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { TeamLogo } from '@/components/ui/team-logo';

interface PlayerResultPopupProps {
  show: boolean;
  playerName: string;
  playerPhotoUrl?: string;
  teamName: string | null;
  teamLogoUrl?: string;
  tournamentLogoUrl?: string;
  amount: number;
  sold: boolean;
  teamColor?: string;
  onClose: () => void;
  /** When false (viewer mode), disables click-to-close and hides the prompt */
  interactive?: boolean;
  /** Avatar size — use '2xl' for larger viewer displays */
  avatarSize?: 'xl' | '2xl' | '3xl';
}

export function PlayerResultPopup({
  show,
  playerName,
  playerPhotoUrl,
  teamName,
  teamLogoUrl,
  tournamentLogoUrl,
  amount,
  sold,
  teamColor = '#3B82F6',
  onClose,
  interactive = true,
  avatarSize = 'xl',
}: PlayerResultPopupProps) {
  // Confetti effect — isolated so onClose/interactive changes don't restart it
  useEffect(() => {
    if (!show || !sold) return;

    const duration = 5000;
    const end = Date.now() + duration;
    let rafId: number;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: [teamColor, '#FFD700', '#FFF'],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: [teamColor, '#FFD700', '#FFF'],
      });

      if (Date.now() < end) {
        rafId = requestAnimationFrame(frame);
      }
    };

    frame();
    return () => cancelAnimationFrame(rafId);
  }, [show, sold, teamColor]);

  // Auto-close after 5 seconds (admin mode only)
  useEffect(() => {
    if (!show || !interactive) return;
    const timeout = setTimeout(onClose, 5000);
    return () => clearTimeout(timeout);
  }, [show, interactive, onClose]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 backdrop-blur-md"
          onClick={interactive ? onClose : undefined}
        >
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 180 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className="text-center px-6"
            onClick={(e) => e.stopPropagation()}
          >
            {sold ? (
              // SOLD
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  className="inline-block mb-6"
                >
                  {tournamentLogoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tournamentLogoUrl}
                      alt="Tournament"
                      className="w-32 h-32 object-contain rounded-2xl"
                    />
                  ) : (
                    <Trophy className="w-32 h-32 text-yellow-500" />
                  )}
                </motion.div>

                <motion.h1
                  initial={{ scale: 0 }}
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ delay: 0.2, duration: 0.5, repeat: Infinity, repeatDelay: 1 }}
                  className="text-8xl font-bold mb-6 text-transparent bg-clip-text bg-linear-to-r from-yellow-400 to-orange-500"
                >
                  SOLD!
                </motion.h1>

                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="space-y-4"
                >
                  <PlayerAvatar 
                    name={playerName} 
                    photoUrl={playerPhotoUrl} 
                    size={avatarSize}
                    className="mx-auto rounded-2xl"
                  />
                  <p className="text-4xl font-bold text-white">{playerName}</p>
                  
                  {/* Team Logo and Name */}
                  <div className="flex items-center justify-center gap-3">
                    <TeamLogo 
                      name={teamName || ''} 
                      logoUrl={teamLogoUrl} 
                      primaryColor={teamColor}
                      size="lg"
                    />
                    <p className="text-3xl font-semibold" style={{ color: teamColor }}>
                      {teamName}
                    </p>
                  </div>
                  
                  <p className="text-6xl font-bold text-yellow-500 mt-4">
                    {formatCurrency(amount)}
                  </p>
                </motion.div>

                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="mt-8"
                >
                  <Sparkles className="w-16 h-16 mx-auto text-yellow-400" />
                </motion.div>
              </>
            ) : (
              // UNSOLD
              <>
                <motion.div
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 0.5, repeat: 3 }}
                  className="inline-block mb-6"
                >
                  <XCircle className="w-32 h-32 text-red-500" />
                </motion.div>

                <motion.h1
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                  className="text-8xl font-bold mb-6 text-red-500"
                >
                  UNSOLD
                </motion.h1>

                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="space-y-4"
                >
                  <PlayerAvatar 
                    name={playerName} 
                    photoUrl={playerPhotoUrl} 
                    size={avatarSize}
                    className="mx-auto rounded-2xl grayscale opacity-75"
                  />
                  <p className="text-4xl font-bold text-white">{playerName}</p>
                  <p className="text-2xl text-slate-400">
                    Base Price: {formatCurrency(amount)}
                  </p>
                  <p className="text-lg text-slate-500 mt-4">
                    No bids received
                  </p>
                </motion.div>
              </>
            )}

            {interactive && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2 }}
                className="text-sm text-slate-400 mt-8"
              >
                Click anywhere to continue
              </motion.p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}