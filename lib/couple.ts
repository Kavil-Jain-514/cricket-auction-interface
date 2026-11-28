// lib/couple.ts
// Couple tournaments (settings.format "couple"): labels and export cells
// shared by the forms, CoupleDetails and the workbook / PDF exports, so they
// all describe a couple the same way. Standard tournaments never call these.
import type { Partner } from '@/convex/validation';

export type TournamentFormat = 'standard' | 'couple';

export const isCoupleFormat = (format: string | undefined): boolean => format === 'couple';

/** The one type a couple member picks, as the form names them. */
export const COUPLE_TYPE_OPTIONS = [
  { value: 'All-Rounder', label: 'Allrounder' },
  { value: 'Batter', label: 'Bat' },
  { value: 'Bowler', label: 'Bowl' },
] as const;

/** "Allrounder" / "Bat" / "Bowl" for a member's role ("" when none). */
export function coupleTypeLabel(role: string | string[] | undefined): string {
  const roles = Array.isArray(role) ? role : role ? [role] : [];
  return roles.map((r) => COUPLE_TYPE_OPTIONS.find((o) => o.value === r)?.label ?? r).join(', ');
}

export const GENDER_LABEL = { male: 'Male', female: 'Female' } as const;

/** The couple-format fields of a registration or player. */
export interface CoupleFields {
  gender?: 'male' | 'female';
  partner?: Partner;
}

/** "Couple" for a couple entry, else the solo entry's gender. */
export function entryKind(entry: CoupleFields): string {
  if (entry.partner) return 'Couple';
  return entry.gender ? GENDER_LABEL[entry.gender] : '';
}

/** Extra export columns in couple tournaments; the female phone only where phones are shown. */
export function coupleColumns(withPhone: boolean): string[] {
  return [
    'Entry',
    ...(withPhone ? ['Female mobile'] : []),
    'Female age',
    'Female type',
    'Female hand',
    'Female jersey no.',
    'Female jersey size',
  ];
}

/** Cells for coupleColumns(withPhone), in the same order. */
export function coupleCells(entry: CoupleFields, withPhone: boolean): Array<string | number> {
  const p = entry.partner;
  return [
    entryKind(entry),
    ...(withPhone ? [p?.phoneNumber ?? ''] : []),
    p?.age ?? '',
    p ? coupleTypeLabel(p.role) : '',
    p?.battingBowlingHand ?? '',
    p?.jerseyNumber ?? '',
    p?.tshirtSize ?? '',
  ];
}
