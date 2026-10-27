"use client";

import type { ReactNode, FormEvent } from 'react';
import { UserRound, Activity, Tag, Check, UserPlus, Pencil, IndianRupee } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Field, FormModal, SectionHeading } from '@/components/ui/form-modal';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { cn, formatCurrency, PLAYER_ROLES, getRoleBadgeBg } from '@/lib/utils';
import { categoryFor, effectiveBasePrice, type PlayerCategory } from '@/convex/bidRules';

export const PLAYER_TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'] as const;
export type TshirtSize = (typeof PLAYER_TSHIRT_SIZES)[number];

export interface PlayerFormValues {
  name: string;
  phoneNumber: string;
  age: number;
  role: string[];
  battingBowlingHand: 'Right-handed' | 'Left-handed' | 'Right' | 'Left';
  tshirtSize: TshirtSize;
  jerseyNumber?: number;
  jerseyName: string;
  basePrice?: number;
  categoryId?: string;
  photoUrl: string;
}

// ── Modal shell ─────────────────────────────────────────────────────────────

interface PlayerFormModalProps {
  mode: 'add' | 'edit';
  title: string;
  subtitle?: string;
  submitLabel: string;
  loadingLabel: string;
  loading: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}

export function PlayerFormModal({ mode, ...props }: PlayerFormModalProps) {
  return <FormModal icon={mode === 'add' ? UserPlus : Pencil} {...props} />;
}

// ── Fields ──────────────────────────────────────────────────────────────────

interface PlayerFormFieldsProps {
  values: PlayerFormValues;
  errors?: Record<string, string>;
  onChange: (patch: Partial<PlayerFormValues>) => void;
  basePricePlaceholder: string;
  basePriceHint: string;
  /** Tournament categories; the Category field shows only when there are some. */
  categories?: PlayerCategory[];
}

export function PlayerFormFields({
  values,
  errors,
  onChange,
  basePricePlaceholder,
  basePriceHint,
  categories,
}: PlayerFormFieldsProps) {
  const inputCls = 'h-11 text-base';
  const isLeft = values.battingBowlingHand.includes('Left');

  const toggleRole = (r: string) =>
    onChange({
      role: values.role.includes(r)
        ? values.role.filter((x) => x !== r)
        : [...values.role, r],
    });

  return (
    <div className="space-y-6">
      {/* Profile */}
      <section>
        <SectionHeading icon={UserRound} title="Player Profile" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr] sm:gap-5">
          <Field label="Photo">
            <ImageUpload
              value={values.photoUrl}
              onChange={(url) => onChange({ photoUrl: url || '' })}
              folder="players"
              aspectRatio="square"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 content-start">
            <Field label="Player Name *" htmlFor="name" error={errors?.name} className="sm:col-span-2">
              <Input
                id="name"
                required
                value={values.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="e.g., Arjun Sharma"
                className={cn(inputCls, errors?.name && 'border-red-500')}
              />
            </Field>

            <Field label="Phone Number" htmlFor="phoneNumber" error={errors?.phoneNumber}>
              <Input
                id="phoneNumber"
                inputMode="numeric"
                value={values.phoneNumber}
                onChange={(e) => onChange({ phoneNumber: e.target.value })}
                placeholder="9876543210"
                className={cn(inputCls, errors?.phoneNumber && 'border-red-500')}
              />
            </Field>

            <Field label="Age *" htmlFor="age" error={errors?.age}>
              <Input
                id="age"
                type="number"
                required
                min="1"
                value={values.age || ''}
                onChange={(e) => onChange({ age: parseInt(e.target.value) || 0 })}
                className={cn(inputCls, errors?.age && 'border-red-500')}
              />
            </Field>
          </div>
        </div>
      </section>

      <div className="h-px bg-slate-800" />

      {/* Playing style */}
      <section>
        <SectionHeading icon={Activity} title="Playing Style" />
        <div className="space-y-4">
          <div>
            <Label className="text-slate-300">Role(s)</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {PLAYER_ROLES.map((r) => {
                const active = values.role.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRole(r)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition',
                      active
                        ? cn(getRoleBadgeBg(r), 'border-transparent text-white shadow-sm')
                        : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
                    )}
                  >
                    {active ? <Check className="h-3.5 w-3.5" /> : null}
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-slate-300">Batting / Bowling Hand *</Label>
              <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-1">
                {(['Right-handed', 'Left-handed'] as const).map((hand) => {
                  const selected = hand === 'Left-handed' ? isLeft : !isLeft;
                  return (
                    <button
                      key={hand}
                      type="button"
                      onClick={() => onChange({ battingBowlingHand: hand })}
                      className={cn(
                        'h-9 rounded-md text-sm font-medium transition',
                        selected
                          ? 'bg-blue-600 text-white shadow'
                          : 'text-slate-300 hover:text-white',
                      )}
                    >
                      {hand}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="text-slate-300">T-Shirt Size</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PLAYER_TSHIRT_SIZES.map((sz) => {
                  const active = values.tshirtSize === sz;
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => onChange({ tshirtSize: sz })}
                      className={cn(
                        'h-9 min-w-10 rounded-md border px-2.5 text-sm font-semibold transition',
                        active
                          ? 'border-blue-500 bg-blue-600 text-white shadow'
                          : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
                      )}
                    >
                      {sz}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="h-px bg-slate-800" />

      {/* Kit & pricing */}
      <section>
        <SectionHeading icon={Tag} title="Kit & Pricing" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Jersey #" htmlFor="jerseyNumber" error={errors?.jerseyNumber}>
            <Input
              id="jerseyNumber"
              type="number"
              min="1"
              max="99"
              value={values.jerseyNumber ?? ''}
              onChange={(e) =>
                onChange({ jerseyNumber: e.target.value ? parseInt(e.target.value) : undefined })
              }
              placeholder="7"
              className={cn(inputCls, errors?.jerseyNumber && 'border-red-500')}
            />
          </Field>

          <Field label="Jersey Name" htmlFor="jerseyName">
            <Input
              id="jerseyName"
              value={values.jerseyName}
              onChange={(e) => onChange({ jerseyName: e.target.value })}
              placeholder="SHARMA"
              className={cn(inputCls, 'uppercase placeholder:normal-case')}
            />
          </Field>

          {categories && categories.length > 0 && (
            <Field label="Category" htmlFor="categoryId" error={errors?.categoryId} className="col-span-2 sm:col-span-1">
              <NativeSelect
                id="categoryId"
                value={values.categoryId ?? ''}
                onChange={(e) => onChange({ categoryId: e.target.value || undefined })}
                className={inputCls}
              >
                <option value="">No category</option>
                {[...categories].sort((a, b) => a.order - b.order).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            </Field>
          )}

          <Field
            label="Base Price (₹)"
            htmlFor="basePrice"
            error={errors?.basePrice}
            hint={basePriceHint}
            className="col-span-2 sm:col-span-1"
          >
            <div className="relative">
              <IndianRupee className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="basePrice"
                type="number"
                value={values.basePrice ?? ''}
                placeholder={basePricePlaceholder}
                onChange={(e) =>
                  onChange({ basePrice: e.target.value ? parseInt(e.target.value) : undefined })
                }
                className={cn(inputCls, 'pl-9')}
              />
            </div>
          </Field>
        </div>
      </section>
    </div>
  );
}

/** "Inherits ₹5.00L from Marquee" — the price an empty Base Price field gets. */
export function inheritedPlaceholder(
  categoryId: string | undefined,
  settings: Parameters<typeof effectiveBasePrice>[1] | undefined,
): string {
  if (!settings) return 'Inherit';
  const price = formatCurrency(effectiveBasePrice({ categoryId }, settings));
  const category = categoryFor(categoryId, settings.categories);
  return `Inherits ${price} from ${category ? category.name : 'tournament'}`;
}
