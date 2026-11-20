"use client";

import { Trophy, XCircle } from 'lucide-react';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { TeamLogo } from '@/components/ui/team-logo';
import { formatCurrency } from '@/lib/utils';

export interface OverlayResultProps {
  sold: boolean;
  playerName: string;
  playerPhotoUrl?: string;
  teamName: string | null;
  teamLogoUrl?: string;
  teamColor?: string;
  tournamentLogoUrl?: string;
  /** Sold price, or the base price when unsold. */
  amount: number;
}

/**
 * The SOLD / UNSOLD card on the broadcast stage (1920x1080 coordinates).
 * Deliberately static: no confetti, spinning logo or pulsing text, so the
 * result reads at a glance on a big screen and OBS never drops frames.
 */
export function OverlayResult({
  sold,
  playerName,
  playerPhotoUrl,
  teamName,
  teamLogoUrl,
  teamColor = '#3B82F6',
  tournamentLogoUrl,
  amount,
}: OverlayResultProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/90 text-white" data-overlay-result>
      <div className="flex items-center gap-16 px-24">
        <PlayerAvatar
          name={playerName}
          photoUrl={playerPhotoUrl}
          size="3xl"
          priority
          className={`rounded-3xl w-150! h-150! shrink-0 ${sold ? '' : 'grayscale opacity-75'}`}
        />
        <div className="flex flex-col gap-6 min-w-0 max-w-200">
          {sold ? (
            <div className="flex items-center gap-6">
              <ImgWithFallback
                src={tournamentLogoUrl}
                alt=""
                className="w-28 h-28 object-contain rounded-2xl"
                fallback={<Trophy className="w-28 h-28 text-yellow-500" />}
              />
              <span className="text-9xl font-extrabold leading-none text-transparent bg-clip-text bg-linear-to-r from-yellow-400 to-orange-500">
                SOLD!
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <XCircle className="w-28 h-28 text-red-500" />
              <span className="text-9xl font-extrabold leading-none text-red-500">UNSOLD</span>
            </div>
          )}
          <p className="text-6xl font-bold leading-tight line-clamp-2 break-words">{playerName}</p>
          {sold ? (
            <>
              <div className="flex items-center gap-4 min-w-0">
                <TeamLogo name={teamName || ''} logoUrl={teamLogoUrl} primaryColor={teamColor} size="lg" />
                <span className="text-5xl font-semibold truncate" style={{ color: teamColor }}>{teamName}</span>
              </div>
              <p className="text-8xl font-extrabold text-yellow-500 tabular-nums">{formatCurrency(amount)}</p>
            </>
          ) : (
            <>
              <p className="text-4xl text-slate-300">{`Base Price: ${formatCurrency(amount)}`}</p>
              <p className="text-3xl text-slate-400">No bids received</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
