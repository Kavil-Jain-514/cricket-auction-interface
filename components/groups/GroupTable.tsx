"use client";

import { useMemo } from 'react';
import { Lock } from 'lucide-react';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { TeamLogo } from '@/components/ui/team-logo';

type Assignment = Doc<"groupDraws">["assignments"][number];

interface GroupTableProps {
  assignments: Assignment[];
  teamsById: Map<Id<"teams">, Doc<"teams">>;
  locked?: boolean;
}

/** Final group table: all groups side by side with their assigned teams. */
export function GroupTable({ assignments, teamsById, locked }: GroupTableProps) {
  const groups = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const slots = map.get(a.group) ?? [];
      slots.push(a);
      map.set(a.group, slots);
    }
    return [...map.entries()];
  }, [assignments]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
      {groups.map(([group, slots]) => (
        <div key={group} className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
            <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
              Group {group}
              {locked && <Lock className="w-3.5 h-3.5 text-yellow-500" />}
            </h3>
            <span className="text-xs text-slate-400">
              {slots.length} team{slots.length !== 1 ? 's' : ''}
            </span>
          </div>
          <ul className="divide-y divide-slate-700/60">
            {slots.map((a) => {
              const team = teamsById.get(a.teamId);
              return (
                <li key={a.slotLabel} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-10 shrink-0 text-center text-xs font-bold text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded-md py-1">
                    {a.slotLabel}
                  </span>
                  <TeamLogo
                    name={team?.name ?? '?'}
                    logoUrl={team?.logoUrl}
                    primaryColor={team?.colorPrimary}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{team?.name ?? 'Unknown team'}</div>
                    {team?.ownerName && (
                      <div className="text-xs text-slate-400 truncate">{team.ownerName}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
