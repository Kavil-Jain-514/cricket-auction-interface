"use client";

import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, XCircle, Users, X, Gavel, Trophy, Wallet, Search,
} from 'lucide-react';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { TeamLogo } from '@/components/ui/team-logo';
import { formatCurrency, getRoleDisplay } from '@/lib/utils';

export type ViewerSheetType = 'sold' | 'unsold' | 'teams';

// ─────────────────────────────────────────────────────────────────────────────
// Fixed bottom action bar — thumb-reachable on mobile, unobtrusive on projector.
// ─────────────────────────────────────────────────────────────────────────────
interface ViewerActionBarProps {
  soldCount: number;
  unsoldCount: number;
  teamsCount: number;
  active: ViewerSheetType | null;
  onOpen: (sheet: ViewerSheetType) => void;
  /** Docked above the buttons, in the same fixed stack (the owner paddle). */
  above?: React.ReactNode;
}

export function ViewerActionBar({
  soldCount,
  unsoldCount,
  teamsCount,
  active,
  onOpen,
  above,
}: ViewerActionBarProps) {
  const buttons: Array<{
    key: ViewerSheetType;
    label: string;
    count: number;
    icon: React.ReactNode;
    active: string;
    idle: string;
    badge: string;
  }> = [
    {
      key: 'sold',
      label: 'Sold',
      count: soldCount,
      icon: <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" />,
      active: 'bg-green-500 border-green-400 text-white shadow-lg shadow-green-500/30',
      idle: 'bg-green-500/10 border-green-500/40 text-green-300 hover:bg-green-500/20',
      badge: 'bg-green-950/40 text-green-100',
    },
    {
      key: 'unsold',
      label: 'Unsold',
      count: unsoldCount,
      icon: <XCircle className="w-5 h-5 sm:w-6 sm:h-6" />,
      active: 'bg-red-500 border-red-400 text-white shadow-lg shadow-red-500/30',
      idle: 'bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20',
      badge: 'bg-red-950/40 text-red-100',
    },
    {
      key: 'teams',
      label: 'Teams',
      count: teamsCount,
      icon: <Users className="w-5 h-5 sm:w-6 sm:h-6" />,
      active: 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/30',
      idle: 'bg-blue-500/10 border-blue-500/40 text-blue-300 hover:bg-blue-500/20',
      badge: 'bg-blue-950/40 text-blue-100',
    },
  ];

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 pointer-events-none px-3 pb-3 sm:pb-4 safe-bottom">
      {above && <div className="max-w-2xl mx-auto mb-2 pointer-events-auto">{above}</div>}
      <div className="max-w-2xl mx-auto grid grid-cols-3 gap-2 sm:gap-3 pointer-events-auto rounded-2xl bg-slate-900/80 backdrop-blur-lg border border-slate-700 p-2 shadow-2xl">
        {buttons.map((b) => {
          const isActive = active === b.key;
          return (
            <button
              key={b.key}
              onClick={() => onOpen(b.key)}
              className={`relative flex flex-col items-center justify-center gap-1 h-14 sm:h-16 rounded-xl border-2 font-semibold text-xs sm:text-sm transition-all touch-target ${
                isActive ? b.active : b.idle
              }`}
            >
              {b.icon}
              <span className="flex items-center gap-1.5">
                {b.label}
                <span className={`inline-flex items-center justify-center min-w-5 px-1.5 h-5 rounded-full text-[10px] font-bold ${b.badge}`}>
                  {b.count}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet shell — bottom-sheet on mobile, centered dialog on desktop.
// ─────────────────────────────────────────────────────────────────────────────
interface SheetShellProps {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  accentClass: string; // header background accent
  onClose: () => void;
  children: React.ReactNode;
}

function SheetShell({ title, subtitle, icon, accentClass, onClose, children }: SheetShellProps) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <motion.div
        className="relative w-full sm:max-w-2xl lg:max-w-3xl max-h-[85vh] sm:max-h-[80vh] bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        initial={{ y: '100%', opacity: 0.5, scale: 1 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1.5 rounded-full bg-slate-600" />
        </div>

        {/* Header */}
        <div className={`flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-700 ${accentClass}`}>
          <div className="shrink-0">{icon}</div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg sm:text-xl font-bold leading-tight truncate">{title}</h3>
            {subtitle && <p className="text-xs sm:text-sm opacity-80 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-9 h-9 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors touch-target"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5 py-3 sm:py-4">
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3">
      <div className="opacity-40">{icon}</div>
      <p className="text-sm sm:text-base">{message}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types for history/teams data
// ─────────────────────────────────────────────────────────────────────────────
export interface SoldHistoryEntry {
  _id: string;
  name: string;
  role: string | string[];
  photoUrl?: string;
  soldPrice: number;
  teamName: string | null;
  teamColor?: string;
  teamLogoUrl?: string;
}

export interface UnsoldHistoryEntry {
  _id: string;
  name: string;
  role: string | string[];
  photoUrl?: string;
  basePrice?: number;
}

export interface ViewerTeam {
  _id: string;
  name: string;
  logoUrl?: string;
  colorPrimary: string;
  purseRemaining: number;
  purseSpent: number;
  playerCount?: number;
}

export interface ViewerSquadPlayer {
  _id: string;
  name: string;
  role: string | string[];
  soldPrice?: number;
  teamId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — renders the active sheet.
// ─────────────────────────────────────────────────────────────────────────────
interface ViewerSheetsProps {
  active: ViewerSheetType | null;
  onClose: () => void;
  // history data (undefined = loading; only fetched for sold/unsold sheets)
  history?: { sold: SoldHistoryEntry[]; unsold: UnsoldHistoryEntry[] };
  teams: ViewerTeam[];
  soldPlayers: ViewerSquadPlayer[] | undefined;
  maxPlayersPerTeam: number;
  currentBidTeamId?: string;
}

export function ViewerSheets({
  active,
  onClose,
  history,
  teams,
  soldPlayers,
  maxPlayersPerTeam,
  currentBidTeamId,
}: ViewerSheetsProps) {
  // Lock body scroll + close on Escape while any sheet is open. Hoisted here
  // (rather than per-sheet) so sheet-to-sheet transitions don't briefly unlock.
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [active, onClose]);

  return (
    <AnimatePresence>
      {active === 'sold' && (
        <SheetShell
          key="sold"
          title="Sold Players"
          subtitle={history ? `${history.sold.length} sold · highest first` : undefined}
          icon={<CheckCircle2 className="w-6 h-6 text-green-300" />}
          accentClass="bg-green-500/15 text-green-100"
          onClose={onClose}
        >
          {!history ? (
            <LoadingState />
          ) : history.sold.length === 0 ? (
            <EmptyState icon={<Trophy className="w-12 h-12" />} message="No players sold yet" />
          ) : (
            <ul className="space-y-2">
              {history.sold.map((p, i) => (
                <li
                  key={p._id}
                  className="flex items-center gap-3 rounded-xl bg-slate-800/60 border border-slate-700 p-2.5 sm:p-3"
                >
                  <span className="w-6 text-center text-xs font-bold text-slate-500 shrink-0">
                    {i + 1}
                  </span>
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="md" className="rounded-lg" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm sm:text-base truncate">{p.name}</div>
                    <div className="text-xs text-slate-400 truncate">{getRoleDisplay(p.role)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm sm:text-base font-bold text-yellow-400">
                      {formatCurrency(p.soldPrice)}
                    </div>
                    {p.teamName && (
                      <div className="flex items-center justify-end gap-1 text-xs text-sky-300 truncate max-w-32">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: p.teamColor ?? '#38bdf8' }}
                        />
                        <span className="truncate">{p.teamName}</span>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SheetShell>
      )}

      {active === 'unsold' && (
        <SheetShell
          key="unsold"
          title="Unsold Players"
          subtitle={history ? `${history.unsold.length} unsold` : undefined}
          icon={<XCircle className="w-6 h-6 text-red-300" />}
          accentClass="bg-red-500/15 text-red-100"
          onClose={onClose}
        >
          {!history ? (
            <LoadingState />
          ) : history.unsold.length === 0 ? (
            <EmptyState icon={<Search className="w-12 h-12" />} message="No unsold players" />
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {history.unsold.map((p) => (
                <li
                  key={p._id}
                  className="flex items-center gap-3 rounded-xl bg-slate-800/60 border border-slate-700 p-2.5 sm:p-3"
                >
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="md" className="rounded-lg" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm sm:text-base truncate">{p.name}</div>
                    <div className="text-xs text-slate-400 truncate">{getRoleDisplay(p.role)}</div>
                  </div>
                  {p.basePrice != null && (
                    <div className="text-xs text-slate-400 shrink-0">
                      Base <span className="text-slate-200 font-semibold">{formatCurrency(p.basePrice)}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SheetShell>
      )}

      {active === 'teams' && (
        <SheetShell
          key="teams"
          title="Teams"
          subtitle={`${teams.length} teams`}
          icon={<Users className="w-6 h-6 text-blue-300" />}
          accentClass="bg-blue-500/15 text-blue-100"
          onClose={onClose}
        >
          <TeamsSheetContent
            teams={teams}
            soldPlayers={soldPlayers}
            maxPlayersPerTeam={maxPlayersPerTeam}
            currentBidTeamId={currentBidTeamId}
          />
        </SheetShell>
      )}
    </AnimatePresence>
  );
}

function TeamsSheetContent({
  teams,
  soldPlayers,
  maxPlayersPerTeam,
  currentBidTeamId,
}: {
  teams: ViewerTeam[];
  soldPlayers: ViewerSquadPlayer[] | undefined;
  maxPlayersPerTeam: number;
  currentBidTeamId?: string;
}) {
  const squadByTeam = useMemo(() => {
    const map: Record<string, ViewerSquadPlayer[]> = {};
    for (const p of soldPlayers ?? []) {
      if (p.teamId) (map[p.teamId] ??= []).push(p);
    }
    // Highest-priced signing first within each squad.
    for (const id of Object.keys(map)) {
      map[id].sort((a, b) => (b.soldPrice ?? 0) - (a.soldPrice ?? 0));
    }
    return map;
  }, [soldPlayers]);

  if (teams.length === 0) {
    return <EmptyState icon={<Users className="w-12 h-12" />} message="No teams yet" />;
  }

  return (
    <div className="space-y-3">
      {teams.map((team) => {
        const squad = squadByTeam[team._id] ?? [];
        const count = team.playerCount ?? squad.length;
        const isBidder = team._id === currentBidTeamId;
        return (
          <div
            key={team._id}
            className={`rounded-2xl border-2 overflow-hidden transition-colors ${
              isBidder ? 'border-yellow-500 bg-yellow-500/5' : 'border-slate-700 bg-slate-800/40'
            }`}
          >
            {/* Team header */}
            <div className="flex items-center gap-3 p-3 sm:p-4">
              <TeamLogo
                name={team.name}
                logoUrl={team.logoUrl}
                primaryColor={team.colorPrimary}
                size="md"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm sm:text-base truncate">{team.name}</span>
                  {isBidder && <Gavel className="w-4 h-4 text-yellow-500 animate-pulse shrink-0" />}
                </div>
                <div className="text-xs text-slate-400">
                  {count}/{maxPlayersPerTeam} players
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="flex items-center justify-end gap-1 text-green-400 font-bold text-sm sm:text-base">
                  <Wallet className="w-3.5 h-3.5" />
                  {formatCurrency(team.purseRemaining)}
                </div>
                <div className="text-[10px] sm:text-xs text-slate-500">
                  spent {formatCurrency(team.purseSpent)}
                </div>
              </div>
            </div>

            {/* Squad list */}
            {squad.length > 0 && (
              <div className="border-t border-slate-700/60 divide-y divide-slate-700/40">
                {squad.map((p) => (
                  <div key={p._id} className="flex items-center gap-2 px-3 sm:px-4 py-2">
                    <span className="flex-1 min-w-0 text-sm truncate">{p.name}</span>
                    <span className="text-xs text-slate-400 truncate hidden sm:block">
                      {getRoleDisplay(p.role)}
                    </span>
                    <span className="text-xs sm:text-sm font-semibold text-yellow-400 shrink-0">
                      {formatCurrency(p.soldPrice ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
