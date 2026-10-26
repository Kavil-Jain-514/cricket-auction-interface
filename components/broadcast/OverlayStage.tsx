"use client";

import { Trophy, Pause } from 'lucide-react';
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
  playerCount: number;
}

export interface OverlayView extends OverlayParams {
  tournament: { name: string; logoUrl?: string; footerText?: string } | null;
  status: string;
  player: { _id: string; name: string; role?: string | string[]; photoUrl?: string } | null;
  basePrice: number;
  currentBid: number;
  isFirstBid: boolean;
  leadingTeam: { name: string; logoUrl?: string; colorPrimary: string } | null;
  ticker: Array<{ id: string; teamName: string; teamColor: string; amount: number }>;
  teams: OverlayTeam[];
  countdown: BidCountdown;
}

const THEMES = {
  dark: {
    panel: 'bg-slate-950/85 text-white border border-white/10 shadow-2xl',
    muted: 'text-slate-300',
    chip: 'bg-white/10 text-white',
    bid: 'bg-linear-to-r from-yellow-500 to-orange-600 text-white',
  },
  light: {
    panel: 'bg-white/92 text-slate-900 border border-slate-900/10 shadow-2xl',
    muted: 'text-slate-600',
    chip: 'bg-slate-900/10 text-slate-900',
    bid: 'bg-linear-to-r from-yellow-400 to-orange-500 text-slate-950',
  },
} as const;

// Title-safe inset is 5% of each edge (96px x 54px at 1080p).
const SAFE_PADDING = 'px-24 py-14';
const DEFAULT_PADDING = 'px-12 py-8';

// CSS opacity/transform only, never layout properties, so OBS keeps 60fps.
const BID_POP = 'animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none';

/**
 * The 1920x1080 broadcast stage. Purely presentational: BroadcastOverlay owns
 * the queries, preloading and the SOLD/UNSOLD stinger.
 */
export function OverlayStage(view: OverlayView) {
  const t = THEMES[view.theme];
  return (
    <div
      className={`relative flex flex-col ${view.safe ? SAFE_PADDING : DEFAULT_PADDING}`}
      style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
    >
      <Branding view={view} />
      <div className="flex-1 min-h-0 flex flex-col justify-end">
        {view.mode === 'full' ? <FullLayout view={view} /> : <LowerThird view={view} />}
      </div>
      {view.tournament?.footerText && (
        <p className={`mt-3 self-end rounded-full px-4 py-1 text-lg font-medium ${t.panel}`}>
          {view.tournament.footerText}
        </p>
      )}
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

function BidBlock({ view, large }: { view: OverlayView; large?: boolean }) {
  const t = THEMES[view.theme];
  return (
    <div className={`rounded-2xl ${large ? 'px-10 py-6' : 'px-8 py-4'} text-center ${t.bid}`}>
      <div className="text-lg font-semibold tracking-widest opacity-90">
        {view.isFirstBid ? 'STARTING PRICE' : 'CURRENT BID'}
      </div>
      <div key={view.currentBid} className={`${large ? 'text-8xl' : 'text-7xl'} font-extrabold leading-none tabular-nums ${BID_POP}`}>
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

function RoleChips({ view }: { view: OverlayView }) {
  const t = THEMES[view.theme];
  const role = view.player?.role ? getRoleDisplay(view.player.role).trim() : '';
  return (
    <div className="flex flex-wrap gap-3">
      {role && <span className={`rounded-full px-5 py-1.5 text-2xl font-semibold ${t.chip}`}>{role}</span>}
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
        <RoleChips view={view} />
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
    <div className="flex-1 min-h-0 flex flex-col gap-6">
      <div className="flex-1 min-h-0 flex items-center justify-center">
        {view.player ? (
          <div className={`flex items-center gap-12 rounded-3xl p-10 ${t.panel}`}>
            <PlayerAvatar name={view.player.name} photoUrl={view.player.photoUrl} size="3xl" priority className="rounded-3xl w-120! h-120!" />
            <div className="flex flex-col gap-6 w-190">
              <h1 className="text-8xl font-extrabold leading-none">{view.player.name}</h1>
              <RoleChips view={view} />
              <div className="flex items-center gap-6">
                <div className="flex-1"><BidBlock view={view} large /></div>
                <Ring countdown={view.countdown} size="lg" />
              </div>
              <LeadingTeam view={view} />
            </div>
          </div>
        ) : (
          <StatusCard view={view} text={text!} />
        )}
      </div>
      <PurseStrip view={view} />
    </div>
  );
}

function PurseStrip({ view }: { view: OverlayView }) {
  const t = THEMES[view.theme];
  if (view.teams.length === 0) return null;
  return (
    <div className={`grid gap-3 rounded-2xl p-4 ${t.panel}`} style={{ gridTemplateColumns: `repeat(${Math.min(view.teams.length, 10)}, minmax(0, 1fr))` }} data-purse-strip>
      {view.teams.map((team) => (
        <div key={team._id} className="flex items-center gap-3 min-w-0 rounded-xl px-3 py-2 border-b-4" style={{ borderBottomColor: team.colorPrimary }}>
          <TeamLogo name={team.name} logoUrl={team.logoUrl} primaryColor={team.colorPrimary} size="sm" />
          <div className="min-w-0">
            <div className="text-lg font-semibold truncate">{team.name}</div>
            <div className={`text-base tabular-nums ${t.muted}`}>
              {formatCurrency(team.purseRemaining)} · {team.playerCount}p
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
