import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import { useEffect } from 'react';

interface PlayerSoldAnimationProps {
  show: boolean;
  playerName: string;
  teamName: string;
  amount: number;
  teamColor: string;
  onComplete: () => void;
}

export function PlayerSoldAnimation({
  show,
  playerName,
  teamName,
  amount,
  teamColor,
  onComplete,
}: PlayerSoldAnimationProps) {
  useEffect(() => {
    if (show) {
      // Confetti burst
      const duration = 3000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 2,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: [teamColor, '#FFD700', '#FFF'],
        });
        confetti({
          particleCount: 2,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: [teamColor, '#FFD700', '#FFF'],
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };
      
      frame();

      // Auto-hide after animation
      const timeout = setTimeout(onComplete, 4000);
      return () => clearTimeout(timeout);
    }
  }, [show, teamColor, onComplete]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        >
          <motion.div
            variants={soldAnimationVariants}
            initial="initial"
            animate="animate"
            className="text-center"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="inline-block mb-6"
            >
              <Trophy className="w-32 h-32 text-yellow-500" />
            </motion.div>

            <motion.h1
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="text-7xl font-bold mb-4 text-transparent bg-clip-text bg-linear-to-r from-yellow-400 to-orange-500"
            >
              SOLD!
            </motion.h1>

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="space-y-4"
            >
              <p className="text-3xl font-bold text-white">{playerName}</p>
              <p className="text-2xl" style={{ color: teamColor }}>
                to {teamName}
              </p>
              <p className="text-5xl font-bold text-yellow-500">
                ₹{(amount / 100000).toFixed(2)}L
              </p>
            </motion.div>

            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="mt-8"
            >
              <Sparkles className="w-16 h-16 mx-auto text-yellow-400" />
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}