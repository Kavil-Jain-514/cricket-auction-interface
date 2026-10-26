"use client";

import type { ReactNode, FormEvent, ComponentType } from 'react';
import { UserRound, Activity, Tag, Check, X, UserPlus, Pencil, IndianRupee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export function PlayerFormModal({
  mode,
  title,
  subtitle,
  submitLabel,
  loadingLabel,
  loading,
  onClose,
  onSubmit,
  children,
}: PlayerFormModalProps) {
  const HeaderIcon = mode === 'add' ? UserPlus : Pencil;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        {/* Header */}
        <div className="relative shrink-0 border-b border-slate-800 bg-linear-to-r from-blue-600/20 via-slate-900 to-purple-600/10 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3 pr-10">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30">
              <HeaderIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-white leading-tight truncate">{title}</h2>
              {subtitle && <p className="text-xs sm:text-sm text-slate-400 truncate">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto ipad-scroll px-5 py-5 sm:px-6">{children}</div>

        {/* Sticky footer */}
        <div className="shrink-0 border-t border-slate-800 bg-slate-900/95 px-5 py-3.5 sm:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="h-11 sm:min-w-28"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="h-11 sm:min-w-40">
              {loading ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  {loadingLabel}
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── Field helpers ───────────────────────────────────────────────────────────

function SectionHeading({ icon: Icon, title, hint }: { icon: ComponentType<{ className?: string }>; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-blue-400">
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {hint && <span className="text-xs text-slate-500">· {hint}</span>}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="text-slate-300">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1 text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
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
              <select
                id="categoryId"
                value={values.categoryId ?? ''}
                onChange={(e) => onChange({ categoryId: e.target.value || undefined })}
                className={cn(inputCls, 'w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-white')}
              >
                <option value="">No category</option>
                {[...categories].sort((a, b) => a.order - b.order).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
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
