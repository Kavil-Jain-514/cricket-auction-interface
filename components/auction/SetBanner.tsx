"use client";

import { AnimatePresence, motion } from 'framer-motion';
import type { PlayerCategory } from '@/convex/bidRules';

interface SetBannerProps {
  /** The category set just entered, or null when hidden. */
  category: PlayerCategory | null;
  onDismiss: () => void;
}

/**
 * "Now: Marquee set" announcement when a by_category auction moves to the
 * next category. Same full-screen pattern as the unsold-round banner.
 */
export function SetBanner({ category, onDismiss }: SetBannerProps) {
  return (
    <AnimatePresence>
      {category && (
        <motion.div
          className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/80 backdrop-blur-md px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDismiss}
          role="status"
          aria-live="assertive"
        >
          <motion.div
            className="relative text-center"
            initial={{ scale: 0.6, y: 30 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          >
            <div
              className="absolute -inset-8 rounded-[2.5rem] blur-3xl opacity-40"
              style={{ backgroundColor: category.colour }}
            />
            <div
              className="relative rounded-3xl border-2 bg-slate-900/70 px-8 py-8 sm:px-16 sm:py-12 shadow-2xl"
              style={{ borderColor: category.colour }}
            >
              <p className="text-xs sm:text-sm font-bold uppercase tracking-[0.3em] text-slate-300 mb-3">Now</p>
              <h2 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold text-white">
                {category.name}
                <span className="block text-2xl sm:text-4xl mt-2" style={{ color: category.colour }}>set</span>
              </h2>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
