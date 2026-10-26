"use client";

import { cn } from '@/lib/utils';

export interface RuleStatus {
  ruleId: string;
  label: string;
  count: number;
  min?: number;
  max?: number;
  ok: boolean;
}

/** "WK 0/1" for a min, "Marquee 2/2 max" for a max, "AR 1/1–3" for both. */
export function ruleStatusText({ label, count, min, max }: RuleStatus): string {
  if (min !== undefined && max !== undefined) return `${label} ${count}/${min}–${max}`;
  if (min !== undefined) return `${label} ${count}/${min}`;
  return `${label} ${count}/${max} max`;
}

/** A team's squad-rule status: amber while a minimum is unmet. Nothing without rules. */
export function RuleStatusLine({ status, className }: { status?: RuleStatus[]; className?: string }) {
  if (!status || status.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', className)} aria-label="Squad rules">
      {status.map((s) => (
        <span
          key={s.ruleId}
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
            s.ok ? 'bg-slate-700 text-slate-300' : 'bg-amber-500/20 text-amber-300',
          )}
        >
          {ruleStatusText(s)}
        </span>
      ))}
    </div>
  );
}
