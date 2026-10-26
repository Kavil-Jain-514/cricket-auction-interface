"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { X, Settings, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/ui/image-upload';
import { toast } from 'sonner';
import { bidTimerSeconds, type IncrementSlab, type PlayerCategory } from '@/convex/bidRules';
import { validateCategories, validateIncrementSlabs } from '@/convex/validation';
import { bidTimerLabel, bidTimerOptions } from '@/lib/bidTimer';
import {
  AuctionRulesEditor,
  categoriesFromForm,
  rulesFormFromSettings,
  slabsFromForm,
  type RulesFormValues,
} from './AuctionRulesEditor';

type BidMode = 'admin_only' | 'confirm' | 'open';

const BID_MODE_OPTIONS: Array<{ value: BidMode; label: string; hint: string }> = [
  { value: 'admin_only', label: 'Auctioneer only', hint: 'Only admins place bids (owners watch).' },
  { value: 'confirm', label: 'Owners raise, auctioneer confirms', hint: "An owner's raise appears on the console; the auctioneer accepts it." },
  { value: 'open', label: 'Open floor', hint: 'Valid owner raises are accepted instantly.' },
];

interface TournamentSettingsModalProps {
  tournamentId: Id<"tournaments">;
  currentSettings: {
    name: string;
    description?: string;
    logoUrl?: string;
    settings: {
      basePurse: number;
      minBidIncrement: number;
      bidTimerSeconds?: number;
      maxPlayersPerTeam: number;
      basePrice?: number;
      footerText?: string;
      bidMode?: BidMode;
      categories?: PlayerCategory[];
      incrementSlabs?: IncrementSlab[];
    };
    status?: string;
  };
  onClose: () => void;
}

export function TournamentSettingsModal({
  tournamentId,
  currentSettings,
  onClose
}: TournamentSettingsModalProps) {
  const updateTournament = useMutation(api.tournaments.update);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'general' | 'rules'>('general');
  const [rules, setRules] = useState<RulesFormValues>(() => rulesFormFromSettings(currentSettings.settings));

  // Numeric fields are kept as the raw input strings so an empty or partial
  // value never turns into NaN in state; they're parsed with Number() on submit.
  const [formData, setFormData] = useState({
    name: currentSettings.name,
    description: currentSettings.description || '',
    logoUrl: currentSettings.logoUrl || '',
    basePurse: String(currentSettings.settings.basePurse),
    minBidIncrement: String(currentSettings.settings.minBidIncrement),
    maxPlayersPerTeam: String(currentSettings.settings.maxPlayersPerTeam),
    basePrice: String(currentSettings.settings.basePrice || 100000),
    footerText: currentSettings.settings.footerText || '',
    bidMode: currentSettings.settings.bidMode ?? 'admin_only',
    bidTimerSeconds: bidTimerSeconds(currentSettings.settings),
  });

  const parsed = {
    basePurse: Number(formData.basePurse),
    minBidIncrement: Number(formData.minBidIncrement),
    maxPlayersPerTeam: Number(formData.maxPlayersPerTeam),
    basePrice: Number(formData.basePrice),
  };

  // Mirrors convex/validation.ts; the server re-checks every value.
  const fieldErrors: Partial<Record<keyof typeof formData, string>> = {};
  const name = formData.name.trim();
  if (name.length < 3 || name.length > 50) {
    fieldErrors.name = 'Name must be 3–50 characters';
  }
  if (formData.basePurse.trim() === '' || !Number.isFinite(parsed.basePurse) || parsed.basePurse < 100000 || parsed.basePurse > 1000000000) {
    fieldErrors.basePurse = 'Enter an amount between ₹1L and ₹100Cr';
  }
  if (formData.minBidIncrement.trim() === '' || !Number.isFinite(parsed.minBidIncrement) || parsed.minBidIncrement < 5000) {
    fieldErrors.minBidIncrement = 'Must be at least ₹5,000';
  } else if (!fieldErrors.basePurse && parsed.minBidIncrement > parsed.basePurse / 10) {
    fieldErrors.minBidIncrement = 'Cannot exceed 10% of the base purse';
  }
  if (formData.basePrice.trim() === '' || !Number.isFinite(parsed.basePrice) || parsed.basePrice <= 0) {
    fieldErrors.basePrice = 'Must be greater than 0';
  } else if (!fieldErrors.basePurse && parsed.basePrice > parsed.basePurse) {
    fieldErrors.basePrice = 'Cannot exceed the base purse';
  }
  if (formData.maxPlayersPerTeam.trim() === '' || !Number.isInteger(parsed.maxPlayersPerTeam) || parsed.maxPlayersPerTeam < 1 || parsed.maxPlayersPerTeam > 50) {
    fieldErrors.maxPlayersPerTeam = 'Enter a whole number from 1 to 50';
  }
  if (formData.footerText.trim().length > 120) {
    fieldErrors.footerText = 'Keep it to 120 characters or fewer';
  }
  const nextCategories = categoriesFromForm(rules.categories);
  const nextSlabs = slabsFromForm(rules.slabs);
  // Same validators the server runs (convex/validation.ts).
  const rulesError =
    validateCategories(nextCategories, parsed.basePurse) ??
    validateIncrementSlabs(nextSlabs, parsed.basePurse);
  const hasErrors = Object.keys(fieldErrors).length > 0 || rulesError !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasErrors) return;
    setLoading(true);

    // Only send settings when one actually changed, so name/description/logo
    // edits still go through while the auction is live (settings are locked).
    const current = currentSettings.settings;
    const settingsChanged =
      parsed.basePurse !== current.basePurse ||
      parsed.minBidIncrement !== current.minBidIncrement ||
      parsed.maxPlayersPerTeam !== current.maxPlayersPerTeam ||
      parsed.basePrice !== (current.basePrice || 100000) ||
      formData.bidTimerSeconds !== bidTimerSeconds(current);
    // Categories and slabs are locked like the money settings; only send them
    // when they changed so unrelated edits still work during a live auction.
    const categoriesChanged =
      JSON.stringify(nextCategories) !== JSON.stringify(categoriesFromForm(rulesFormFromSettings(current).categories));
    const slabsChanged = JSON.stringify(nextSlabs) !== JSON.stringify(current.incrementSlabs ?? []);
    const rulesChanged = categoriesChanged || slabsChanged;
    // Footer text is not locked, so it can change during a live auction.
    const footerChanged = formData.footerText.trim() !== (current.footerText || '');
    // Neither is bid mode — the auctioneer can switch modes mid-auction.
    const bidModeChanged = formData.bidMode !== (current.bidMode ?? 'admin_only');

    try {
      await updateTournament({
        id: tournamentId,
        name: formData.name,
        description: formData.description || undefined,
        logoUrl: formData.logoUrl || undefined,
        ...(settingsChanged || rulesChanged || footerChanged || bidModeChanged
          ? {
              settings: {
                ...parsed,
                bidTimerSeconds: formData.bidTimerSeconds,
                ...(footerChanged ? { footerText: formData.footerText.trim() } : {}),
                ...(bidModeChanged ? { bidMode: formData.bidMode } : {}),
                ...(categoriesChanged ? { categories: nextCategories } : {}),
                ...(slabsChanged ? { incrementSlabs: nextSlabs } : {}),
              },
            }
          : {}),
      });

      toast.success('Tournament updated successfully!');
      onClose();
    } catch (error) {
      toast.error('Failed to update settings', {
        description: (error as Error).message
      });
    } finally {
      setLoading(false);
    }
  };

  const fieldError = (field: keyof typeof formData) =>
    fieldErrors[field] ? (
      <p className="text-xs text-red-400 mt-1">{fieldErrors[field]}</p>
    ) : null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-blue-500" />
            <h2 className="text-2xl font-bold">Tournament Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/40 rounded-lg p-4 mb-6">
          <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-200">
            These settings apply across the whole tournament. Changing the base purse updates
            every team&apos;s purse. Settings are locked while the auction is live — restart the
            auction to change them.
          </p>
        </div>

        <div role="tablist" aria-label="Settings sections" className="mb-6 flex gap-1 rounded-lg bg-slate-800 p-1">
          {([
            ['general', 'General'],
            ['rules', 'Categories & Rules'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${tab === key ? 'bg-slate-950 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {label}
              {(key === 'rules' ? rulesError !== null : Object.keys(fieldErrors).length > 0) && (
                <span className="ml-2 inline-block h-2 w-2 rounded-full bg-red-500" aria-label="has errors" />
              )}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {tab === 'rules' && (
            <AuctionRulesEditor
              value={rules}
              onChange={setRules}
              minBidIncrement={parsed.minBidIncrement || currentSettings.settings.minBidIncrement}
              error={rulesError}
            />
          )}

          <div className={tab === 'general' ? 'space-y-6' : 'hidden'}>
          {/* Basic Info Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-300 border-b border-slate-700 pb-2">
              Basic Information
            </h3>

            <div>
              <Label htmlFor="name">Tournament Name *</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., IPL 2026"
                className="mt-2"
              />
              {fieldError('name')}
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter tournament description..."
                className="mt-2 min-h-20"
              />
            </div>

            <div>
              <Label>Tournament Logo</Label>
              <div className="mt-2">
                <ImageUpload
                  value={formData.logoUrl || undefined}
                  onChange={(url) => setFormData({ ...formData, logoUrl: url || '' })}
                  folder="tournaments"
                  aspectRatio="square"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="footerText">Viewer Footer Text</Label>
              <Input
                id="footerText"
                value={formData.footerText}
                onChange={(e) => setFormData({ ...formData, footerText: e.target.value })}
                placeholder="e.g., Hosted by Sunrise Cricket Club"
                maxLength={120}
                className="mt-2"
              />
              <p className="text-xs text-slate-400 mt-1">
                Optional. Shown under the Bid11Pro name on the live viewer page. Leave empty to hide.
              </p>
              {fieldError('footerText')}
            </div>

            <div>
              <Label htmlFor="bidMode">Who can bid</Label>
              <select
                id="bidMode"
                value={formData.bidMode}
                onChange={(e) => setFormData({ ...formData, bidMode: e.target.value as BidMode })}
                className="mt-2 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
              >
                {BID_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                {BID_MODE_OPTIONS.find((o) => o.value === formData.bidMode)?.hint} Invite owners from each team card. Can be changed during the auction.
              </p>
            </div>
          </div>

          {/* Auction Settings Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-300 border-b border-slate-700 pb-2">
              Auction Settings
            </h3>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="basePurse">Base Purse per Team (₹) *</Label>
                <Input
                  id="basePurse"
                  type="number"
                  required
                  min="100000"
                  step="100000"
                  value={formData.basePurse}
                  onChange={(e) => setFormData({ ...formData, basePurse: e.target.value })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  ₹{((parsed.basePurse || 0) / 100000).toFixed(1)}L per team
                </p>
                {fieldError('basePurse')}
              </div>

              <div>
                <Label htmlFor="minBidIncrement">Minimum Bid Increment (₹) *</Label>
                <Input
                  id="minBidIncrement"
                  type="number"
                  required
                  min="5000"
                  step="5000"
                  value={formData.minBidIncrement}
                  onChange={(e) => setFormData({ ...formData, minBidIncrement: e.target.value })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  ₹{((parsed.minBidIncrement || 0) / 1000).toFixed(0)}K increment
                </p>
                {fieldError('minBidIncrement')}
              </div>

              <div>
                <Label htmlFor="basePrice">Base Player Price (₹) *</Label>
                <Input
                  id="basePrice"
                  type="number"
                  required
                  value={formData.basePrice}
                  onChange={(e) => setFormData({ ...formData, basePrice: e.target.value })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Default: ₹{((parsed.basePrice || 0) / 100000).toFixed(1)}L
                </p>
                {fieldError('basePrice')}
              </div>

              <div>
                <Label htmlFor="maxPlayersPerTeam">Max Players per Team *</Label>
                <Input
                  id="maxPlayersPerTeam"
                  type="number"
                  required
                  value={formData.maxPlayersPerTeam}
                  onChange={(e) => setFormData({ ...formData, maxPlayersPerTeam: e.target.value })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Maximum squad size
                </p>
                {fieldError('maxPlayersPerTeam')}
              </div>

              <div>
                <Label htmlFor="bidTimerSeconds">Bid Timer</Label>
                <select
                  id="bidTimerSeconds"
                  value={formData.bidTimerSeconds}
                  onChange={(e) => setFormData({ ...formData, bidTimerSeconds: Number(e.target.value) })}
                  className="mt-2 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                >
                  {bidTimerOptions(bidTimerSeconds(currentSettings.settings)).map((s) => (
                    <option key={s} value={s}>{bidTimerLabel(s)}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  A countdown that resets on every bid. It never sells on its own — at zero the console prompts you.
                </p>
              </div>
            </div>
          </div>

          </div>

          {/* Actions */}
          <div className="pt-4 flex gap-3 border-t border-slate-700">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || hasErrors}
              className="flex-1"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
