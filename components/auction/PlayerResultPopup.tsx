"use client";

import { Trophy, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
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
  // Auto-close after 5 seconds (admin mode only)
  useEffect(() => {
    if (!show || !interactive) return;
    const timeout = setTimeout(onClose, 5000);
    return () => clearTimeout(timeout);
  }, [show, interactive, onClose]);

  if (!show) return null;

  // Static on purpose: no confetti, spinning logo or pulsing text.
  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/90"
      onClick={interactive ? onClose : undefined}
    >
      <div className="text-center px-6" onClick={(e) => e.stopPropagation()}>
        {sold ? (
          <>
            <div className="inline-block mb-6">
              <ImgWithFallback
                src={tournamentLogoUrl}
                alt="Tournament"
                className="w-32 h-32 object-contain rounded-2xl"
                fallback={<Trophy className="w-32 h-32 text-yellow-500" />}
              />
            </div>
            <h1 className="text-8xl font-bold mb-6 text-yellow-400">SOLD!</h1>
            <div className="space-y-4">
              <PlayerAvatar name={playerName} photoUrl={playerPhotoUrl} size={avatarSize} className="mx-auto rounded-2xl" />
              <p className="text-4xl font-bold text-white">{playerName}</p>
              <div className="flex items-center justify-center gap-3">
                <TeamLogo name={teamName || ''} logoUrl={teamLogoUrl} primaryColor={teamColor} size="lg" />
                <p className="text-3xl font-semibold" style={{ color: teamColor }}>
                  {teamName}
                </p>
              </div>
              <p className="text-6xl font-bold text-yellow-500 mt-4">{formatCurrency(amount)}</p>
            </div>
          </>
        ) : (
          <>
            <XCircle className="w-32 h-32 text-red-500 mx-auto mb-6" />
            <h1 className="text-8xl font-bold mb-6 text-red-500">UNSOLD</h1>
            <div className="space-y-4">
              <PlayerAvatar
                name={playerName}
                photoUrl={playerPhotoUrl}
                size={avatarSize}
                className="mx-auto rounded-2xl grayscale opacity-75"
              />
              <p className="text-4xl font-bold text-white">{playerName}</p>
              <p className="text-2xl text-slate-400">Base Price: {formatCurrency(amount)}</p>
              <p className="text-lg text-slate-500 mt-4">No bids received</p>
            </div>
          </>
        )}

        {interactive && <p className="text-sm text-slate-400 mt-8">Click anywhere to continue</p>}
      </div>
    </div>
  );
}
