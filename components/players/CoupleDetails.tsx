import { coupleTypeLabel } from '@/lib/couple';
import { cn } from '@/lib/utils';

interface Member {
  role?: string | string[];
  battingBowlingHand?: string;
  age?: number;
  ranking?: number;
  jerseyNumber?: number;
  tshirtSize?: string;
  phoneNumber?: string;
}

interface CoupleDetailsProps {
  /** A player or registration: its own fields are the male member. */
  player: Member & { partner?: Member };
  /** One short line per member, for tight spaces (overlay, cards). */
  compact?: boolean;
  /** Admin views: show both members' phones. */
  showPhones?: boolean;
  className?: string;
}

function memberParts(m: Member, compact: boolean, showPhone: boolean): string[] {
  const hand = m.battingBowlingHand ? (m.battingBowlingHand.startsWith('Left') ? (compact ? 'LH' : 'Left-handed') : compact ? 'RH' : 'Right-handed') : '';
  return [
    coupleTypeLabel(m.role),
    hand,
    m.age ? (compact ? `${m.age}y` : `${m.age} yrs`) : '',
    m.ranking !== undefined ? `Rk ${m.ranking}` : '',
    compact ? '' : m.jerseyNumber !== undefined ? `#${m.jerseyNumber}` : '',
    compact ? '' : (m.tshirtSize ?? ''),
    showPhone ? (m.phoneNumber ?? '') : '',
  ].filter(Boolean);
}

/** The two members of a couple (Male / Female). Renders nothing for a solo player. */
export function CoupleDetails({ player, compact = false, showPhones = false, className }: CoupleDetailsProps) {
  if (!player.partner) return null;
  const rows = [
    { label: 'Male', parts: memberParts(player, compact, showPhones) },
    { label: 'Female', parts: memberParts(player.partner, compact, showPhones) },
  ];
  return (
    <dl className={cn(compact ? 'space-y-0.5 text-xs' : 'space-y-1 text-sm', className)}>
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 gap-1.5">
          <dt className={cn('shrink-0 font-semibold', row.label === 'Male' ? 'text-sky-300' : 'text-pink-300')}>{row.label}</dt>
          <dd className="min-w-0 truncate text-slate-300">{row.parts.join(' · ') || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
