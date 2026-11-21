"use client";

import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Shirt, Phone } from 'lucide-react';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { getRoles } from '@/lib/utils';

const roleColors: Record<string, { bg: string; text: string; border: string }> = {
  'Batter': { bg: 'bg-blue-600/20', text: 'text-blue-400', border: 'border-blue-500' },
  'Bowler': { bg: 'bg-orange-600/20', text: 'text-orange-400', border: 'border-orange-500' },
  'All-Rounder': { bg: 'bg-purple-600/20', text: 'text-purple-400', border: 'border-purple-500' },
  'All Rounder': { bg: 'bg-purple-600/20', text: 'text-purple-400', border: 'border-purple-500' },
  'Wicket Keeper': { bg: 'bg-emerald-600/20', text: 'text-emerald-400', border: 'border-emerald-500' },
  'Wicket-Keeper': { bg: 'bg-green-600/20', text: 'text-green-400', border: 'border-green-500' },
};

export interface PlayerProfile {
  name: string;
  photoUrl?: string;
  role: string | string[];
  age?: number;
  battingBowlingHand?: string;
  phoneNumber?: string;
  tshirtSize?: string;
  jerseyNumber?: number;
  jerseyName?: string;
}

interface PlayerProfileShellProps {
  profile: PlayerProfile;
  /** Status chip shown next to the role chips. */
  badge: { label: string; className: string };
  onClose: () => void;
  /** Sections shown below Personal Details. */
  children?: ReactNode;
}

/** The player card modal: gradient header, avatar, roles, personal details, then the caller's sections. */
export function PlayerProfileShell({ profile, badge, onClose, children }: PlayerProfileShellProps) {
  const roles = getRoles(profile.role);
  const primaryRole = roles[0];

  // Gradient based on primary role
  const gradientClass = primaryRole === 'Batter' ? 'from-blue-600 to-blue-800' :
    primaryRole === 'Bowler' ? 'from-orange-600 to-orange-800' :
      primaryRole?.includes('All') ? 'from-purple-600 to-purple-800' :
        primaryRole === 'Wicket Keeper' ? 'from-emerald-600 to-emerald-800' :
          'from-green-600 to-green-800';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          role="dialog"
          aria-modal="true"
          aria-label={profile.name}
          className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full overflow-hidden my-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with gradient */}
          <div className={`relative h-28 sm:h-32 bg-linear-to-br ${gradientClass}`}>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 p-2 bg-black/30 hover:bg-black/50 rounded-full transition"
            >
              <X className="w-5 h-5 text-white" />
            </button>

            {/* Player avatar positioned at bottom of header */}
            <div className="absolute -bottom-12 left-1/2 -translate-x-1/2">
              <div className="p-1.5 bg-slate-900 rounded-2xl">
                <PlayerAvatar
                  name={profile.name}
                  photoUrl={profile.photoUrl}
                  size="2xl"
                  className="w-24! h-24! sm:w-28! sm:h-28!"
                />
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="pt-16 pb-6 px-5 sm:px-6">
            {/* Name and Role */}
            <div className="text-center mb-6">
              <h2 className="text-2xl sm:text-3xl font-bold mb-2">{profile.name}</h2>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {roles.map((r) => {
                  const rs = roleColors[r] || roleColors['Batter'];
                  return (
                    <span key={r} className={`px-3 py-1 rounded-full text-sm font-semibold ${rs.bg} ${rs.text} border ${rs.border}`}>
                      {r}
                    </span>
                  );
                })}
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${badge.className}`}>
                  {badge.label}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              {/* Personal Details */}
              <div className="bg-slate-800/50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Personal Details
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-slate-500">Age</span>
                    <p className="font-semibold">{profile.age ? `${profile.age} years` : '—'}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Style</span>
                    <p className="font-semibold">{profile.battingBowlingHand}</p>
                  </div>
                  {profile.phoneNumber && (
                    <div className="col-span-2">
                      <span className="text-slate-500 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> Phone
                      </span>
                      <p className="font-semibold">{profile.phoneNumber}</p>
                    </div>
                  )}
                  {profile.tshirtSize && (
                    <div>
                      <span className="text-slate-500 flex items-center gap-1">
                        <Shirt className="w-3 h-3" /> T-Shirt
                      </span>
                      <p className="font-semibold">{profile.tshirtSize}</p>
                    </div>
                  )}
                  {profile.jerseyNumber && (
                    <div>
                      <span className="text-slate-500">Jersey #</span>
                      <p className="font-semibold">#{profile.jerseyNumber}</p>
                    </div>
                  )}
                  {profile.jerseyName && (
                    <div>
                      <span className="text-slate-500">Jersey Name</span>
                      <p className="font-semibold">{profile.jerseyName}</p>
                    </div>
                  )}
                </div>
              </div>

              {children}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
