"use client";

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { formatAnswer } from '@/lib/registrationsWorkbook';
import { formatCurrency } from '@/lib/utils';
import { IndianRupee, Trophy, ClipboardList } from 'lucide-react';
import { PlayerProfileShell } from '@/components/players/PlayerProfileShell';
import { CoupleDetails } from '@/components/players/CoupleDetails';

interface PlayerDetailsModalProps {
  player: Doc<"players">;
  teamName?: string;
  onClose: () => void;
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  'pending': { bg: 'bg-slate-600/20', text: 'text-slate-400', label: 'Pending' },
  'in_auction': { bg: 'bg-yellow-600/20', text: 'text-yellow-400', label: 'In Auction' },
  'sold': { bg: 'bg-green-600/20', text: 'text-green-400', label: 'Sold' },
  'unsold': { bg: 'bg-red-600/20', text: 'text-red-400', label: 'Unsold' },
};

export function PlayerDetailsModal({
  player,
  teamName,
  onClose
}: PlayerDetailsModalProps) {
  // The organiser's own registration questions; null unless the caller owns the tournament.
  const answers = useQuery(api.registrationForms.answersForPlayer, { playerId: player._id });
  const statusStyle = statusConfig[player.auctionStatus] || statusConfig['pending'];

  return (
    <PlayerProfileShell
      profile={player}
      badge={{ label: statusStyle.label, className: `${statusStyle.bg} ${statusStyle.text}` }}
      onClose={onClose}
    >
      {player.partner && (
        <div className="bg-slate-800/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-400 mb-3">Couple</h3>
          {/* Phones are only on the player for the tournament's staff. */}
          <CoupleDetails player={player} showPhones />
        </div>
      )}

      {/* Auction Details */}
      <div className="bg-slate-800/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
          <IndianRupee className="w-4 h-4" />
          Auction Details
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between py-2 border-b border-slate-700">
            <span className="text-slate-400">Base Price</span>
            <span className="font-semibold text-white">
              {formatCurrency(player.basePrice ?? 100000)}
            </span>
          </div>
          {player.soldPrice && (
            <div>
              <span className="text-slate-500">Sold Price</span>
              <p className="font-semibold text-yellow-400 text-lg">
                {formatCurrency(player.soldPrice)}
              </p>
            </div>
          )}
          {teamName && (
            <div className="col-span-2">
              <span className="text-slate-500">Team</span>
              <p className="font-semibold text-blue-400">{teamName}</p>
            </div>
          )}
        </div>
      </div>

      {/* Statistics */}
      {player.stats && (player.stats.matches || player.stats.runs || player.stats.wickets) && (
        <div className="bg-slate-800/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
            <Trophy className="w-4 h-4" />
            Career Statistics
          </h3>
          <div className="grid grid-cols-4 gap-2 text-center">
            {player.stats.matches !== undefined && (
              <div className="bg-slate-700/50 rounded-lg p-2">
                <p className="text-lg font-bold">{player.stats.matches}</p>
                <span className="text-xs text-slate-400">Matches</span>
              </div>
            )}
            {player.stats.runs !== undefined && (
              <div className="bg-slate-700/50 rounded-lg p-2">
                <p className="text-lg font-bold text-blue-400">{player.stats.runs}</p>
                <span className="text-xs text-slate-400">Runs</span>
              </div>
            )}
            {player.stats.wickets !== undefined && (
              <div className="bg-slate-700/50 rounded-lg p-2">
                <p className="text-lg font-bold text-orange-400">{player.stats.wickets}</p>
                <span className="text-xs text-slate-400">Wickets</span>
              </div>
            )}
            {player.stats.average !== undefined && (
              <div className="bg-slate-700/50 rounded-lg p-2">
                <p className="text-lg font-bold text-green-400">{player.stats.average.toFixed(1)}</p>
                <span className="text-xs text-slate-400">Average</span>
              </div>
            )}
          </div>
        </div>
      )}

      {answers && answers.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            Registration answers
          </h3>
          <dl className="space-y-2 text-sm">
            {answers.map((a) => (
              <div key={a.questionId}>
                <dt className="text-xs text-slate-400">{a.label}{a.archived ? ' (archived)' : ''}</dt>
                <dd className="break-words text-slate-100">
                  {a.type === 'file' && typeof a.value === 'string' ? (
                    <a href={a.value} target="_blank" rel="noopener noreferrer" className="text-blue-300 underline">View image</a>
                  ) : (
                    formatAnswer(a.value, a.type)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </PlayerProfileShell>
  );
}
