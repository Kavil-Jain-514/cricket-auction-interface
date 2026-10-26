"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { IncrementSlab, PlayerCategory } from '@/convex/bidRules';
import { formatCurrency } from '@/lib/utils';

// Numeric fields are raw input strings (as in TournamentSettingsModal) so an
// empty or partial value never becomes NaN in state.
export interface CategoryRow {
  id: string;
  name: string;
  basePrice: string;
  colour: string;
}

export interface SlabRow {
  fromAmount: string;
  increment: string;
}

export type PresentationOrder = 'random' | 'by_category';

export interface RulesFormValues {
  categories: CategoryRow[];
  slabs: SlabRow[];
  presentationOrder: PresentationOrder;
}

const DEFAULT_COLOURS = ['#f59e0b', '#2563eb', '#16a34a', '#db2777', '#7c3aed', '#0891b2'];

export function rulesFormFromSettings(settings: {
  categories?: PlayerCategory[];
  incrementSlabs?: IncrementSlab[];
  presentationOrder?: PresentationOrder;
}): RulesFormValues {
  return {
    presentationOrder: settings.presentationOrder ?? 'random',
    categories: [...(settings.categories ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ id: c.id, name: c.name, basePrice: String(c.basePrice), colour: c.colour })),
    slabs: (settings.incrementSlabs ?? []).map((s) => ({
      fromAmount: String(s.fromAmount),
      increment: String(s.increment),
    })),
  };
}

/** List position is the category order (marquee first). */
export function categoriesFromForm(rows: CategoryRow[]): PlayerCategory[] {
  return rows.map((r, order) => ({
    id: r.id,
    name: r.name.trim(),
    basePrice: Number(r.basePrice),
    order,
    colour: r.colour,
  }));
}

/** Sorted by threshold so the organiser can enter slabs in any order. */
export function slabsFromForm(rows: SlabRow[]): IncrementSlab[] {
  return rows
    .map((r) => ({ fromAmount: Number(r.fromAmount), increment: Number(r.increment) }))
    .sort((a, b) => a.fromAmount - b.fromAmount);
}

function newCategoryId(): string {
  return `cat_${Math.random().toString(36).slice(2, 10)}`;
}

interface AuctionRulesEditorProps {
  value: RulesFormValues;
  onChange: (value: RulesFormValues) => void;
  /** Flat increment used when no slab applies. */
  minBidIncrement: number;
  error: string | null;
}

export function AuctionRulesEditor({ value, onChange, minBidIncrement, error }: AuctionRulesEditorProps) {
  const setCategories = (categories: CategoryRow[]) => onChange({ ...value, categories });
  const setSlabs = (slabs: SlabRow[]) => onChange({ ...value, slabs });

  const patchCategory = (i: number, patch: Partial<CategoryRow>) =>
    setCategories(value.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const moveCategory = (i: number, by: -1 | 1) => {
    const next = [...value.categories];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setCategories(next);
  };
  const patchSlab = (i: number, patch: Partial<SlabRow>) =>
    setSlabs(value.slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-300">Player categories</h3>
          <p className="text-xs text-slate-400 mt-1">
            A player with no base price of their own starts at their category&apos;s price. Order is top to bottom.
          </p>
        </div>

        {value.categories.length === 0 && (
          <p className="text-sm text-slate-500">No categories. Every player uses their own or the tournament base price.</p>
        )}

        {value.categories.map((c, i) => (
          <div key={c.id} className="grid grid-cols-[auto_1fr_8rem_auto] items-end gap-2">
            <div className="flex flex-col">
              <button type="button" aria-label={`Move ${c.name || 'category'} up`} disabled={i === 0} onClick={() => moveCategory(i, -1)} className="p-1 text-slate-400 hover:text-white disabled:opacity-30">
                <ArrowUp className="w-4 h-4" />
              </button>
              <button type="button" aria-label={`Move ${c.name || 'category'} down`} disabled={i === value.categories.length - 1} onClick={() => moveCategory(i, 1)} className="p-1 text-slate-400 hover:text-white disabled:opacity-30">
                <ArrowDown className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-end gap-2">
              <input
                type="color"
                value={c.colour}
                onChange={(e) => patchCategory(i, { colour: e.target.value })}
                aria-label={`${c.name || 'Category'} colour`}
                className="h-9 w-10 shrink-0 cursor-pointer rounded border border-slate-600 bg-slate-800"
              />
              <div className="flex-1">
                <Label htmlFor={`cat-name-${c.id}`} className="text-xs">Name</Label>
                <Input id={`cat-name-${c.id}`} value={c.name} maxLength={30} onChange={(e) => patchCategory(i, { name: e.target.value })} placeholder="e.g. Marquee" className="mt-1" />
              </div>
            </div>
            <div>
              <Label htmlFor={`cat-price-${c.id}`} className="text-xs">Base price (₹)</Label>
              <Input id={`cat-price-${c.id}`} type="number" min="1" value={c.basePrice} onChange={(e) => patchCategory(i, { basePrice: e.target.value })} className="mt-1" />
            </div>
            <button type="button" aria-label={`Remove ${c.name || 'category'}`} onClick={() => setCategories(value.categories.filter((_, j) => j !== i))} className="mb-1 p-2 text-slate-400 hover:text-red-400">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
          onClick={() =>
            setCategories([
              ...value.categories,
              { id: newCategoryId(), name: '', basePrice: '', colour: DEFAULT_COLOURS[value.categories.length % DEFAULT_COLOURS.length] },
            ])
          }
        >
          <Plus className="w-4 h-4" /> Add category
        </Button>
      </section>

      <section className="space-y-2">
        <Label htmlFor="presentationOrder" className="text-lg font-semibold text-slate-300">Player order</Label>
        <select
          id="presentationOrder"
          value={value.presentationOrder}
          onChange={(e) => onChange({ ...value, presentationOrder: e.target.value as PresentationOrder })}
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="random">Random</option>
          <option value="by_category" disabled={value.categories.length === 0}>By category (sets, in the order above)</option>
        </select>
        <p className="text-xs text-slate-400">
          {value.presentationOrder === 'by_category'
            ? 'Each category is auctioned as a set, top to bottom, in random order within the set. Players with no category go last. Unsold rounds stay random.'
            : 'Players come up in random order.'}
        </p>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-300">Bid increment slabs</h3>
          <p className="text-xs text-slate-400 mt-1">
            From a price, every raise goes up by that slab&apos;s increment. Below the first slab, or with none, raises use the
            minimum bid increment ({formatCurrency(minBidIncrement)}).
          </p>
        </div>

        {value.slabs.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <div>
              <Label htmlFor={`slab-from-${i}`} className="text-xs">From bid (₹)</Label>
              <Input id={`slab-from-${i}`} type="number" min="0" value={s.fromAmount} onChange={(e) => patchSlab(i, { fromAmount: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label htmlFor={`slab-inc-${i}`} className="text-xs">Increment (₹)</Label>
              <Input id={`slab-inc-${i}`} type="number" min="5000" step="5000" value={s.increment} onChange={(e) => patchSlab(i, { increment: e.target.value })} className="mt-1" />
            </div>
            <button type="button" aria-label="Remove slab" onClick={() => setSlabs(value.slabs.filter((_, j) => j !== i))} className="mb-1 p-2 text-slate-400 hover:text-red-400">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
          onClick={() => setSlabs([...value.slabs, { fromAmount: '', increment: String(minBidIncrement) }])}
        >
          <Plus className="w-4 h-4" /> Add slab
        </Button>
      </section>
    </div>
  );
}
