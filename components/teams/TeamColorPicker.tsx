"use client";

import { Check, Plus } from 'lucide-react';
import { Label } from '@/components/ui/label';

/**
 * Single source of truth for team colors, shared by the Add and Edit team
 * forms so both always show the exact same palette. Each entry pairs a
 * `primary` shade with a slightly darker `secondary` used for the gradient.
 */
export const TEAM_PRESET_COLORS = [
  { primary: '#3B82F6', secondary: '#1D4ED8', name: 'Blue' },
  { primary: '#EF4444', secondary: '#DC2626', name: 'Red' },
  { primary: '#10B981', secondary: '#059669', name: 'Green' },
  { primary: '#F97316', secondary: '#EA580C', name: 'Orange' },
  { primary: '#8B5CF6', secondary: '#7C3AED', name: 'Purple' },
  { primary: '#EC4899', secondary: '#DB2777', name: 'Pink' },
  { primary: '#14B8A6', secondary: '#0D9488', name: 'Teal' },
  { primary: '#FACC15', secondary: '#EAB308', name: 'Yellow' },
  { primary: '#6366F1', secondary: '#4F46E5', name: 'Indigo' },
  { primary: '#64748B', secondary: '#475569', name: 'Slate' },
] as const;

/** Derive a darker companion shade for a custom-picked primary color. */
function darkenHex(hex: string, factor = 0.78): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const r = Math.round(((num >> 16) & 0xff) * factor);
  const g = Math.round(((num >> 8) & 0xff) * factor);
  const b = Math.round((num & 0xff) * factor);
  return (
    '#' +
    [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')
  );
}

interface TeamColorPickerProps {
  primary: string;
  secondary: string;
  onChange: (primary: string, secondary: string) => void;
  label?: string;
  className?: string;
}

export function TeamColorPicker({
  primary,
  secondary,
  onChange,
  label = 'Team Color',
  className,
}: TeamColorPickerProps) {
  const isPreset = TEAM_PRESET_COLORS.some(
    (c) => c.primary.toLowerCase() === primary.toLowerCase(),
  );
  // When the current color isn't one of the presets, the custom swatch is active.
  const customActive = !isPreset;

  return (
    <div className={className}>
      {label && <Label>{label}</Label>}
      <div className={`${label ? 'mt-2 ' : ''}flex flex-wrap items-center gap-2`}>
        {TEAM_PRESET_COLORS.map((color) => {
          const selected = primary.toLowerCase() === color.primary.toLowerCase();
          return (
            <button
              key={color.name}
              type="button"
              onClick={() => onChange(color.primary, color.secondary)}
              title={color.name}
              aria-label={color.name}
              aria-pressed={selected}
              className={`relative flex h-8 w-8 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                selected
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900'
                  : 'ring-1 ring-white/10 hover:ring-white/40'
              }`}
              style={{
                background: `linear-gradient(135deg, ${color.primary}, ${color.secondary})`,
              }}
            >
              {selected && (
                <Check className="h-3.5 w-3.5 text-white drop-shadow" strokeWidth={3} />
              )}
            </button>
          );
        })}

        {/* Custom color — opens the native color picker */}
        <label
          title="Custom color"
          className={`relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition focus-within:ring-2 focus-within:ring-white/80 ${
            customActive
              ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900'
              : 'ring-1 ring-white/10 hover:ring-white/40'
          }`}
          style={
            customActive
              ? { background: `linear-gradient(135deg, ${primary}, ${secondary})` }
              : {
                  background:
                    'conic-gradient(from 0deg, #ef4444, #f97316, #facc15, #10b981, #14b8a6, #3b82f6, #6366f1, #8b5cf6, #ec4899, #ef4444)',
                }
          }
        >
          <input
            type="color"
            value={primary}
            onChange={(e) => onChange(e.target.value, darkenHex(e.target.value))}
            className="sr-only"
            aria-label="Pick a custom team color"
          />
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900/70 backdrop-blur-sm">
            {customActive ? (
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            ) : (
              <Plus className="h-3 w-3 text-white" strokeWidth={3} />
            )}
          </span>
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {customActive ? 'Custom color selected' : 'Pick a preset or choose a custom color'}
      </p>
    </div>
  );
}
