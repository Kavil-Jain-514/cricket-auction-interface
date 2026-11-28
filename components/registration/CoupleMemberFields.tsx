"use client";

import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Field, formInputCls } from '@/components/ui/form-modal';
import { PLAYER_TSHIRT_SIZES, type TshirtSize } from '@/components/players/PlayerFormFields';
import { COUPLE_TYPE_OPTIONS } from '@/lib/couple';
import type { Partner } from '@/convex/validation';
import { cn, getRoleBadgeBg } from '@/lib/utils';

/** One couple member as the inputs hold it (numbers as typed). */
export interface MemberValues {
  phoneNumber: string;
  age: string;
  /** One of COUPLE_TYPE_OPTIONS' values, or '' for none. */
  type: string;
  battingBowlingHand: 'Right-handed' | 'Left-handed';
  tshirtSize: '' | TshirtSize;
  jerseyNumber: string;
}

export const EMPTY_MEMBER: MemberValues = {
  phoneNumber: '',
  age: '',
  type: '',
  battingBowlingHand: 'Right-handed',
  tshirtSize: '',
  jerseyNumber: '',
};

const toNumber = (raw: string) => (raw.trim() ? Number(raw) : undefined);

/** A member's values as the server takes them (the partner, or the male member's own fields). */
export function memberToEntry(m: MemberValues): Partner & { phoneNumber: string } {
  return {
    phoneNumber: m.phoneNumber,
    age: toNumber(m.age),
    role: m.type ? [m.type] : [],
    battingBowlingHand: m.battingBowlingHand,
    tshirtSize: m.tshirtSize || undefined,
    jerseyNumber: toNumber(m.jerseyNumber),
  };
}

/** Stored member fields back into input values (for editing). */
export function entryToMember(p: Partial<Partner> | undefined): MemberValues {
  if (!p) return EMPTY_MEMBER;
  return {
    phoneNumber: p.phoneNumber ?? '',
    age: p.age != null ? String(p.age) : '',
    type: p.role?.[0] ?? '',
    battingBowlingHand: p.battingBowlingHand ?? 'Right-handed',
    tshirtSize: p.tshirtSize ?? '',
    jerseyNumber: p.jerseyNumber != null ? String(p.jerseyNumber) : '',
  };
}

interface CoupleMemberFieldsProps {
  /** "Male" or "Female". */
  title: string;
  /** Unique per block, for input ids. */
  idPrefix: string;
  value: MemberValues;
  onChange: (patch: Partial<MemberValues>) => void;
  /** Which fields the organiser requires (adds " *"). */
  required?: { age?: boolean; role?: boolean; tshirtSize?: boolean; jerseyNumber?: boolean };
  /** Fields the organiser removed from the form (not shown). */
  hidden?: { age?: boolean; role?: boolean; tshirtSize?: boolean; jerseyNumber?: boolean };
}

/** Phone, age, type, hand, jersey size and number for one member of a couple. */
export function CoupleMemberFields({ title, idPrefix, value, onChange, required = {}, hidden = {} }: CoupleMemberFieldsProps) {
  const label = (text: string, on?: boolean) => (on ? `${text} *` : text);
  const id = (field: string) => `${idPrefix}-${field}`;

  return (
    <fieldset className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <legend className="px-1 text-sm font-semibold text-slate-200">{title}</legend>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone Number (CricHeroes) *" htmlFor={id('phone')}>
          <Input id={id('phone')} required inputMode="tel" value={value.phoneNumber} onChange={(e) => onChange({ phoneNumber: e.target.value })} placeholder="98765 43210" className={formInputCls} />
        </Field>
        {!hidden.age && (
          <Field label={label('Age', required.age)} htmlFor={id('age')}>
            <Input id={id('age')} required={required.age} type="number" min="5" max="80" value={value.age} onChange={(e) => onChange({ age: e.target.value })} className={formInputCls} />
          </Field>
        )}
      </div>

      {!hidden.role && (
      <div role="group" aria-label={`${title} type`}>
        <span className="text-sm font-medium text-slate-300">{label('Type', required.role)}</span>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {COUPLE_TYPE_OPTIONS.map((o) => {
            const on = value.type === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ type: on ? '' : o.value })}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-medium transition',
                  on ? cn(getRoleBadgeBg(o.value), 'border-transparent text-white shadow-sm') : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
                )}
              >
                {on && <Check className="h-3.5 w-3.5" />}
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      )}

      <div role="group" aria-label={`${title} batting / bowling hand`} className="grid grid-cols-2 gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-1">
        {(['Right-handed', 'Left-handed'] as const).map((hand) => (
          <button
            key={hand}
            type="button"
            aria-pressed={value.battingBowlingHand === hand}
            onClick={() => onChange({ battingBowlingHand: hand })}
            className={cn('h-10 rounded-md text-sm font-medium transition', value.battingBowlingHand === hand ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:text-white')}
          >
            {hand}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {!hidden.tshirtSize && (
          <Field label={label('Jersey size', required.tshirtSize)} htmlFor={id('size')}>
            <NativeSelect id={id('size')} required={required.tshirtSize} value={value.tshirtSize} onChange={(e) => onChange({ tshirtSize: e.target.value as MemberValues['tshirtSize'] })} className={formInputCls}>
              <option value="">—</option>
              {PLAYER_TSHIRT_SIZES.map((s) => <option key={s}>{s}</option>)}
            </NativeSelect>
          </Field>
        )}
        {!hidden.jerseyNumber && (
          <Field label={label('Jersey #', required.jerseyNumber)} htmlFor={id('jersey')}>
            <Input id={id('jersey')} required={required.jerseyNumber} type="number" min="1" max="99" value={value.jerseyNumber} onChange={(e) => onChange({ jerseyNumber: e.target.value })} className={formInputCls} />
          </Field>
        )}
      </div>
    </fieldset>
  );
}
