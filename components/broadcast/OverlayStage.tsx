"use client";

import { useEffect, useState } from 'react';
import { Trophy, Pause, Users, X } from 'lucide-react';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { TeamLogo } from '@/components/ui/team-logo';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { BidTimerRing } from '@/components/auction/BidTimerRing';
import type { BidCountdown } from '@/hooks/useBidCountdown';
import { formatCurrency, getRoleDisplay } from '@/lib/utils';
import type { OverlayParams } from '@/lib/overlayParams';

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export interface OverlayTeam {
  _id: string;
  name: string;
  logoUrl?: string;
  colorPrimary: string;
  purseRemaining: number;
  purseSpent: number;
  playerCount: number;
}

export interface OverlayPlayer {
  _id: string;
  name: string;
  role?: string | string[];
  photoUrl?: string;
  playerNumber?: number;
  age?: number;
  battingBowlingHand?: string;
}

export interface OverlayView extends OverlayParams {
  tournament: { name: string; logoUrl?: string; footerText?: string } | null;
  status: string;
  player: OverlayPlayer | null;
  basePrice: number;
  currentBid: number;
  isFirstBid: boolean;
  leadingTeam: { name: string; logoUrl?: string; colorPrimary: string } | null;
  ticker: Array<{ id: string; teamName: string; teamColor: string; amount: number }>;
  teams: OverlayTeam[];
  /** Squad size, for the teams panel's "players bought" count. */
  maxPlayersPerTeam?: number;
  countdown: BidCountdown;
}

const THEMES = {
  dark: {
    panel: 'bg-slate-950/85 text-white border border-white/10 shadow-2xl',
    muted: 'text-slate-300',
    chip: 'bg-white/10 text-white',
    screen: 'bg-slate-950 text-white',
    bid: 'bg-linear-to-r from-yellow-500 to-orange-600 text-white',
  },
  light: {
    panel: 'bg-white/92 text-slate-900 border border-slate-900/10 shadow-2xl',
    muted: 'text-slate-600',
    chip: 'bg-slate-900/10 text-slate-900',
    screen: 'bg-slate-50 text-slate-900',
    bid: 'bg-linear-to-r from-yellow-400 to-orange-500 text-slate-950',
  },
} as const;

// Title-safe inset is 5% of each edge (96px x 54px at 1080p).
const SAFE_PADDING = 'px-24 py-14';
const DEFAULT_PADDING = 'px-12 py-8';

// CSS opacity/transform only, never layout properties, so OBS keeps 60fps.
const BID_POP = 'animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none';

/**
 * The broadcast stage (1920x1080, wider or taller to fill the window). Presentational apart from the teams panel
 * toggle: BroadcastOverlay owns the queries, preloading and the SOLD/UNSOLD card.
 */
export function OverlayStage(view: OverlayView) {
  const t = THEMES[view.theme];
  const [teamsOpen, setTeamsOpen] = useState(false);

  useEffect(() => {
    if (!teamsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTeamsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [teamsOpen]);

  return (
    <div
      className={`relative flex flex-col ${view.safe ? SAFE_PADDING : DEFAULT_PADDING}`}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Logo | timer (full mode: above the card) | Teams */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
        <Branding view={view} />
        <div className="col-start-2 self-center" data-header-timer>
          {view.mode === 'full' && view.player && <Ring countdown={view.countdown} size="lg" />}
        </div>
        {view.teams.length > 0 && (
          <button
            type="button"
            onClick={() => setTeamsOpen(true)}
            className={`col-start-3 justify-self-end inline-flex items-center gap-3 rounded-full px-6 py-3 text-2xl font-semibold cursor-pointer ${t.panel}`}
            data-teams-button
          >
            <Users className="w-7 h-7" /> Teams
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col justify-end">
        {view.mode === 'full' ? <FullLayout view={view} /> : <LowerThird view={view} />}
      </div>
      {view.tournament?.footerText && (
        <p className={`mt-3 self-end rounded-full px-4 py-1 text-lg font-medium ${t.panel}`}>
          {view.tournament.footerText}
        </p>
      )}
      {teamsOpen && <TeamsPanel view={view} onClose={() => setTeamsOpen(false)} />}
    </div>
  );
}

function Branding({ view }: { view: OverlayView }) {
  const t = THEMES[view.theme];
  if (!view.tournament) return null;
  return (
    <div className="flex items-center gap-4 self-start">
      <div className={`rounded-2xl p-2 ${t.panel}`}>
        <ImgWithFallback
          src={view.tournament.logoUrl}
          alt=""
          className="w-20 h-20 object-contain rounded-xl"
          fallback={<Trophy className="w-20 h-20 text-yellow-500" />}
        />
      </div>
      {view.status === 'paused' && (
        <span className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-2xl font-bold ${t.panel}`}>
          <Pause className="w-6 h-6" /> Paused
        </span>
      )}
    </div>
  );
}

function Ring({ countdown, size }: { countdown: BidCountdown; size: 'md' | 'lg' }) {
  if (!countdown.enabled) return null;
  // Dark disc behind the ring so its white digits read on either theme.
  return (
    <div className="rounded-full bg-slate-900/90 p-1.5 shrink-0">
      <BidTimerRing countdown={countdown} size={size} />
    </div>
  );
}

function BidBlock({ view }: { view: OverlayView }) {
  const t = THEMES[view.theme];
  return (
    <div className={`rounded-2xl px-8 py-4 text-center ${t.bid}`}>
      <div className="text-lg font-semibold tracking-widest opacity-90">
        {view.isFirstBid ? 'STARTING PRICE' : 'CURRENT BID'}
      </div>
      <div key={view.currentBid} className={`text-7xl font-extrabold leading-none tabular-nums ${BID_POP}`}>
        {formatCurrency(view.currentBid)}
      </div>
    </div>
  );
}

function LeadingTeam({ view }: { view: OverlayView }) {
  const t = THEMES[view.theme];
  if (!view.leadingTeam || view.isFirstBid) return null;
  return (
    <div
      className={`flex items-center gap-3 rounded-xl pl-3 pr-5 py-2 border-l-8 ${t.chip}`}
      style={{ borderLeftColor: view.leadingTeam.colorPrimary }}
    >
      <TeamLogo name={view.leadingTeam.name} logoUrl={view.leadingTeam.logoUrl} primaryColor={view.leadingTeam.colorPrimary} size="md" />
      <span className="text-3xl font-bold">{view.leadingTeam.name}</span>
    </div>
  );
}

function Ticker({ view }: { view: OverlayView }) {
  const t = THEMES[view.theme];
  if (view.ticker.length === 0) return null;
  return (
    <ol className="flex flex-col gap-2 w-80" aria-label="Recent bids">
      {view.ticker.map((bid, i) => (
        <li
          key={bid.id}
          className={`flex items-center justify-between gap-3 rounded-lg px-4 py-2 text-xl ${t.chip} ${i === 0 ? 'font-bold' : `opacity-70 ${t.muted}`}`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: bid.teamColor }} />
            <span className="truncate">{bid.teamName}</span>
          </span>
          <span className="tabular-nums">{formatCurrency(bid.amount)}</span>
        </li>
      ))}
    </ol>
  );
}

function PlayerChips({ view }: { view: OverlayView }) {
  const t = THEMES[view.theme];
  const player = view.player;
  const role = player?.role ? getRoleDisplay(player.role).trim() : '';
  const chip = `rounded-full px-5 py-1.5 text-2xl ${t.chip}`;
  return (
    <div className="flex flex-wrap gap-3">
      {player?.playerNumber ? (
        <span className="rounded-full px-5 py-1.5 text-2xl font-extrabold bg-blue-600 text-white">#{player.playerNumber}</span>
      ) : null}
      {role && <span className={`${chip} font-semibold`}>{role}</span>}
      {player?.battingBowlingHand && <span className={chip}>{player.battingBowlingHand}</span>}
      {player?.age ? <span className={chip}>{`${player.age} yrs`}</span> : null}
      <span className={`rounded-full px-5 py-1.5 text-2xl ${t.chip}`}>{`Base ${formatCurrency(view.basePrice)}`}</span>
    </div>
  );
}

function StatusCard({ view, text }: { view: OverlayView; text: string }) {
  const t = THEMES[view.theme];
  return (
    <div className={`self-center rounded-2xl px-12 py-6 text-4xl font-bold ${t.panel}`}>{text}</div>
  );
}

function idleText(status: string): string | null {
  if (status === 'completed') return 'Auction complete';
  if (status === 'waiting') return 'Auction starting soon';
  return null;
}

function LowerThird({ view }: { view: OverlayView }) {
  const t = THEMES[view.theme];
  if (!view.player) {
    const text = idleText(view.status);
    return text ? <StatusCard view={view} text={text} /> : null;
  }
  return (
    <div className={`flex items-center gap-8 rounded-3xl p-6 ${t.panel}`} data-lower-third>
      <PlayerAvatar name={view.player.name} photoUrl={view.player.photoUrl} size="2xl" priority className="rounded-2xl w-56! h-56!" />
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <h1 className="text-6xl font-extrabold leading-none truncate">{view.player.name}</h1>
        <PlayerChips view={view} />
        <LeadingTeam view={view} />
      </div>
      <BidBlock view={view} />
      <Ticker view={view} />
      <Ring countdown={view.countdown} size="lg" />
    </div>
  );
}

function FullLayout({ view }: { view: OverlayView }) {
  const t = THEMES[view.theme];
  const text = view.player ? null : idleText(view.status) ?? 'Next player coming up';
  return (
    <div className="flex-1 min-h-0 mt-6 flex items-stretch justify-center" data-full-layout>
      {view.player ? (
        // Half photo, half details; the timer sits above the card in the header.
        <div className={`w-full h-full grid grid-cols-2 gap-10 rounded-3xl p-8 ${t.panel}`}>
          <PlayerAvatar name={view.player.name} photoUrl={view.player.photoUrl} size="3xl" priority className="rounded-3xl w-full! h-full! min-h-0" />
          <div className="min-w-0 flex flex-col justify-center gap-6" data-player-details>
            <h1 className="text-7xl font-extrabold leading-tight line-clamp-2 wrap-break-word">{view.player.name}</h1>
            <PlayerChips view={view} />
            <BidBlock view={view} />
            <LeadingTeam view={view} />
          </div>
        </div>
      ) : (
        <div className="self-center">
          <StatusCard view={view} text={text!} />
        </div>
      )}
    </div>
  );
}

function teamColumns(count: number): number {
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return 5;
}

/** Full-screen team table, opened from the Teams button: players bought and purse left. */
export function TeamsPanel({ view, onClose }: { view: OverlayView; onClose: () => void }) {
  const t = THEMES[view.theme];
  const max = view.maxPlayersPerTeam;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="overlay-teams-title"
      className={`absolute inset-0 z-10 flex flex-col gap-8 ${view.safe ? SAFE_PADDING : DEFAULT_PADDING} ${t.screen}`}
      data-teams-panel
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="overlay-teams-title" className="text-5xl font-extrabold">
          {view.tournament?.name ? `${view.tournament.name} · Teams` : 'Teams'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-2xl font-semibold cursor-pointer ${t.chip}`}
          aria-label="Close teams"
        >
          <X className="w-7 h-7" /> Close
        </button>
      </div>
      <div
        className="flex-1 min-h-0 grid gap-5 auto-rows-fr"
        style={{ gridTemplateColumns: `repeat(${teamColumns(view.teams.length)}, minmax(0, 1fr))` }}
      >
        {view.teams.map((team) => (
          <div
            key={team._id}
            className={`min-h-0 flex flex-col justify-center gap-3 rounded-2xl px-6 py-4 border-l-8 ${t.chip}`}
            style={{ borderLeftColor: team.colorPrimary }}
          >
            <div className="flex items-center gap-4 min-w-0">
              <TeamLogo name={team.name} logoUrl={team.logoUrl} primaryColor={team.colorPrimary} size="lg" />
              <span className="text-3xl font-bold truncate">{team.name}</span>
            </div>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className={`text-lg font-semibold tracking-wider ${t.muted}`}>PLAYERS</div>
                <div className="text-4xl font-extrabold tabular-nums">
                  {team.playerCount}{max ? <span className={`text-2xl font-semibold ${t.muted}`}>{` / ${max}`}</span> : null}
                </div>
              </div>
              <div className="text-right">
                <div className={`text-lg font-semibold tracking-wider ${t.muted}`}>PURSE LEFT</div>
                <div className="text-4xl font-extrabold tabular-nums">{formatCurrency(team.purseRemaining)}</div>
                <div className={`text-lg tabular-nums ${t.muted}`}>{`Spent ${formatCurrency(team.purseSpent)}`}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
