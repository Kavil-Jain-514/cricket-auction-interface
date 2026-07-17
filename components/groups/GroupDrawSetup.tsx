"use client";

import { useMemo, useState } from 'react';
import { Shuffle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getGroupSizes, groupName, validateGroupConfig } from '@/lib/groupDraw';

interface GroupDrawSetupProps {
  teamCount: number;
  onRun: (numGroups: number) => void;
  running: boolean;
}

/**
 * Draw configuration panel: pick the number of groups, preview exactly how
 * teams will be distributed (including uneven splits), then start the draw.
 */
export function GroupDrawSetup({ teamCount, onRun, running }: GroupDrawSetupProps) {
  const [numGroupsText, setNumGroupsText] = useState('2');

  const numGroups = Number(numGroupsText);
  const parsed = numGroupsText.trim() !== '' && Number.isFinite(numGroups) ? numGroups : NaN;
  const error = Number.isNaN(parsed)
    ? 'Enter the number of groups'
    : validateGroupConfig(teamCount, parsed);

  const sizes = useMemo(
    () => (error === null ? getGroupSizes(teamCount, parsed) : null),
    [error, teamCount, parsed],
  );
  const isUneven = sizes !== null && new Set(sizes).size > 1;
  // Uneven splits put the extra team in the earliest groups (the larger size)
  const extraGroups = sizes ? sizes.filter((s) => s === sizes[0]).length : 0;

  return (
    <div className="max-w-2xl bg-slate-800/50 border border-slate-700 rounded-xl p-5 sm:p-6">
      <h2 className="text-lg sm:text-xl font-bold mb-1">Configure Group Draw</h2>
      <p className="text-slate-400 text-sm mb-5">
        {teamCount} team{teamCount !== 1 ? 's' : ''} will be randomly allotted to groups.
        Groups are named A, B, C… and slots within each group are labeled A1, A2, B1…
      </p>

      <div className="mb-4">
        <Label htmlFor="numGroups" className="mb-2 block">Number of groups</Label>
        <Input
          id="numGroups"
          type="number"
          min={1}
          max={Math.max(teamCount, 1)}
          step={1}
          value={numGroupsText}
          onChange={(e) => setNumGroupsText(e.target.value)}
          aria-invalid={error !== null}
          className="w-32 h-11 border-slate-600 text-white"
        />
        {error !== null ? (
          <p className="text-red-400 text-sm mt-2">{error}</p>
        ) : (
          <p className="text-slate-400 text-sm mt-2">
            Groups must be between 1 and {teamCount} (the number of teams).
          </p>
        )}
      </div>

      {/* Distribution preview — shown before the draw so uneven splits are never a surprise */}
      {sizes && (
        <div className="mb-5">
          <div className="text-sm text-slate-400 mb-2">Distribution preview</div>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size, i) => (
              <span
                key={groupName(i)}
                className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm font-medium text-blue-300"
              >
                Group {groupName(i)} · {size} team{size !== 1 ? 's' : ''}
              </span>
            ))}
          </div>
          {isUneven && (
            <div className="flex items-start gap-2 mt-3 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {teamCount} teams don&apos;t split evenly into {parsed} groups —
                the first {extraGroups === 1 ? 'group gets' : `${extraGroups} groups get`} an
                extra team.
              </span>
            </div>
          )}
        </div>
      )}

      <Button
        onClick={() => onRun(parsed)}
        disabled={error !== null || running}
        className="h-11 px-5"
      >
        <Shuffle className="w-4 h-4 mr-2" />
        {running ? 'Drawing…' : 'Run Draw'}
      </Button>
    </div>
  );
}
