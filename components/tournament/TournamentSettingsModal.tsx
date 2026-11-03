"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Settings, Info, Trophy, Gavel, ClipboardList, Megaphone, Plus, Trash2, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/ui/image-upload';
import { NativeSelect } from '@/components/ui/native-select';
import { Field, FormDivider, FormModal, FormTabs, SectionHeading, formInputCls } from '@/components/ui/form-modal';
import { toast } from 'sonner';
import { bidTimerSeconds, type IncrementSlab, type PlayerCategory } from '@/convex/bidRules';
import { validateCategories, validateIncrementSlabs, validateSquadRules } from '@/convex/validation';
import type { SquadRule } from '@/convex/squadRules';
import { bidTimerLabel, bidTimerOptions } from '@/lib/bidTimer';
import { StaffManager } from './StaffManager';
import {
  AuctionRulesEditor,
  categoriesFromForm,
  rulesFormFromSettings,
  slabsFromForm,
  squadRulesFromForm,
  type RulesFormValues,
} from './AuctionRulesEditor';

type BidMode = 'admin_only' | 'confirm' | 'open';
type Tab = 'general' | 'auction' | 'registration' | 'rules' | 'staff';

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
    sponsors?: Array<{ name: string; logoUrl?: string }>;
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
      presentationOrder?: 'random' | 'by_category';
      squadRules?: SquadRule[];
      registrationOpen?: boolean;
      registrationFee?: number;
      paymentQrUrl?: string;
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
  const [tab, setTab] = useState<Tab>('general');
  const [sponsors, setSponsors] = useState(() => (currentSettings.sponsors ?? []).map((sp) => ({ name: sp.name, logoUrl: sp.logoUrl ?? '' })));
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
    registrationOpen: currentSettings.settings.registrationOpen ?? false,
    registrationFee: String(currentSettings.settings.registrationFee ?? 0),
    paymentQrUrl: currentSettings.settings.paymentQrUrl ?? '',
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
  const registrationFee = Number(formData.registrationFee);
  if (formData.registrationFee.trim() === '' || !Number.isInteger(registrationFee) || registrationFee < 0 || registrationFee > 100000) {
    fieldErrors.registrationFee = 'Enter whole rupees from 0 to 1,00,000';
  }
  if (formData.footerText.trim().length > 120) {
    fieldErrors.footerText = 'Keep it to 120 characters or fewer';
  }
  // Mirrors normalizeSponsors in convex/validation.ts.
  const sponsorsError = sponsors.length > 12
    ? 'Add at most 12 sponsors'
    : sponsors.some((sp) => sp.name.trim() === '' || sp.name.trim().length > 60)
      ? 'Every sponsor needs a name (up to 60 characters)'
      : null;
  const nextCategories = categoriesFromForm(rules.categories);
  const nextSlabs = slabsFromForm(rules.slabs);
  // Same validators the server runs (convex/validation.ts).
  const nextSquadRules = squadRulesFromForm(rules.squadRules);
  const rulesError =
    validateCategories(nextCategories, parsed.basePurse) ??
    validateIncrementSlabs(nextSlabs, parsed.basePurse) ??
    validateSquadRules(nextSquadRules, nextCategories.map((c) => c.id), parsed.maxPlayersPerTeam);
  const generalError = Boolean(fieldErrors.name || fieldErrors.footerText);
  const auctionError = Boolean(fieldErrors.basePurse || fieldErrors.minBidIncrement || fieldErrors.basePrice || fieldErrors.maxPlayersPerTeam);
  const registrationError = Boolean(fieldErrors.registrationFee) || sponsorsError !== null;
  const hasErrors = Object.keys(fieldErrors).length > 0 || rulesError !== null || sponsorsError !== null;

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
    const orderChanged = rules.presentationOrder !== (current.presentationOrder ?? 'random');
    const squadRulesChanged =
      JSON.stringify(nextSquadRules) !== JSON.stringify(squadRulesFromForm(rulesFormFromSettings(current).squadRules));
    const rulesChanged = categoriesChanged || slabsChanged || orderChanged || squadRulesChanged;
    // Footer text is not locked, so it can change during a live auction.
    const footerChanged = formData.footerText.trim() !== (current.footerText || '');
    // Neither is bid mode — the auctioneer can switch modes mid-auction.
    const bidModeChanged = formData.bidMode !== (current.bidMode ?? 'admin_only');
    // Nor is the public registration form.
    const registrationChanged =
      formData.registrationOpen !== (current.registrationOpen ?? false) ||
      registrationFee !== (current.registrationFee ?? 0) ||
      formData.paymentQrUrl !== (current.paymentQrUrl ?? '');
    // Sponsors aren't settings: sent on their own, only when they changed.
    const nextSponsors = sponsors.map((sp) => (sp.logoUrl ? { name: sp.name.trim(), logoUrl: sp.logoUrl } : { name: sp.name.trim() }));
    const sponsorsChanged = JSON.stringify(nextSponsors) !== JSON.stringify(currentSettings.sponsors ?? []);

    try {
      await updateTournament({
        id: tournamentId,
        name: formData.name,
        description: formData.description || undefined,
        logoUrl: formData.logoUrl || undefined,
        ...(sponsorsChanged ? { sponsors: nextSponsors } : {}),
        ...(settingsChanged || rulesChanged || footerChanged || bidModeChanged || registrationChanged
          ? {
              settings: {
                ...parsed,
                bidTimerSeconds: formData.bidTimerSeconds,
                ...(footerChanged ? { footerText: formData.footerText.trim() } : {}),
                ...(bidModeChanged ? { bidMode: formData.bidMode } : {}),
                ...(categoriesChanged ? { categories: nextCategories } : {}),
                ...(slabsChanged ? { incrementSlabs: nextSlabs } : {}),
                ...(orderChanged ? { presentationOrder: rules.presentationOrder } : {}),
                ...(squadRulesChanged ? { squadRules: nextSquadRules } : {}),
                ...(registrationChanged ? { registrationOpen: formData.registrationOpen, registrationFee, paymentQrUrl: formData.paymentQrUrl } : {}),
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

  const patch = (p: Partial<typeof formData>) => setFormData((prev) => ({ ...prev, ...p }));
  const patchSponsor = (i: number, p: Partial<(typeof sponsors)[number]>) =>
    setSponsors((prev) => prev.map((sp, j) => (j === i ? { ...sp, ...p } : sp)));

  return (
    <FormModal
      icon={Settings}
      title="Tournament Settings"
      subtitle="Money and squad settings lock while the auction is live"
      width="3xl"
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel="Save Changes"
      loadingLabel="Saving…"
      loading={loading}
      submitDisabled={hasErrors}
      nav={
        <FormTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'general', label: 'General', error: generalError },
            { key: 'auction', label: 'Auction', error: auctionError },
            { key: 'registration', label: 'Registration', error: registrationError },
            { key: 'rules', label: 'Categories & Rules', error: rulesError !== null },
            { key: 'staff', label: 'Staff' },
          ]}
        />
      }
    >
      {tab === 'general' && (
        <section>
          <SectionHeading icon={Trophy} title="Basic Information" />
          <div className="grid grid-cols-[6.5rem_1fr] gap-4 sm:grid-cols-[8.5rem_1fr] sm:gap-5">
            <Field label="Logo">
              <ImageUpload
                value={formData.logoUrl || undefined}
                onChange={(url) => patch({ logoUrl: url || '' })}
                folder="tournaments"
                aspectRatio="square"
              />
            </Field>
            <div className="space-y-3">
              <Field label="Tournament Name *" htmlFor="name" error={fieldErrors.name}>
                <Input id="name" required value={formData.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g., IPL 2026" className={formInputCls} />
              </Field>
              <Field label="Description" htmlFor="description">
                <Textarea id="description" rows={2} value={formData.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Shown on the registration form" className="min-h-16 resize-none" />
              </Field>
            </div>
          </div>
          <Field
            label="Viewer Footer Text"
            htmlFor="footerText"
            error={fieldErrors.footerText}
            hint="Optional. Shown under the Bid11Pro name on the live viewer page."
            className="mt-3"
          >
            <Input id="footerText" value={formData.footerText} onChange={(e) => patch({ footerText: e.target.value })} placeholder="e.g., Hosted by Sunrise Cricket Club" maxLength={120} className={formInputCls} />
          </Field>
        </section>
      )}

      {tab === 'auction' && (
        <section>
          <SectionHeading icon={Gavel} title="Auction Settings" hint="base purse changes update every team" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Base Purse per Team (₹) *" htmlFor="basePurse" error={fieldErrors.basePurse} hint={`₹${((parsed.basePurse || 0) / 100000).toFixed(1)}L per team`}>
              <Input id="basePurse" type="number" required min="100000" step="100000" value={formData.basePurse} onChange={(e) => patch({ basePurse: e.target.value })} className={formInputCls} />
            </Field>
            <Field label="Minimum Bid Increment (₹) *" htmlFor="minBidIncrement" error={fieldErrors.minBidIncrement} hint={`₹${((parsed.minBidIncrement || 0) / 1000).toFixed(0)}K increment`}>
              <Input id="minBidIncrement" type="number" required min="5000" step="5000" value={formData.minBidIncrement} onChange={(e) => patch({ minBidIncrement: e.target.value })} className={formInputCls} />
            </Field>
            <Field label="Base Player Price (₹) *" htmlFor="basePrice" error={fieldErrors.basePrice} hint={`Default: ₹${((parsed.basePrice || 0) / 100000).toFixed(1)}L`}>
              <Input id="basePrice" type="number" required value={formData.basePrice} onChange={(e) => patch({ basePrice: e.target.value })} className={formInputCls} />
            </Field>
            <Field label="Max Players per Team *" htmlFor="maxPlayersPerTeam" error={fieldErrors.maxPlayersPerTeam} hint="Maximum squad size">
              <Input id="maxPlayersPerTeam" type="number" required value={formData.maxPlayersPerTeam} onChange={(e) => patch({ maxPlayersPerTeam: e.target.value })} className={formInputCls} />
            </Field>
            <Field label="Bid Timer" htmlFor="bidTimerSeconds" hint="Resets on every bid. It never sells on its own; at zero the console prompts you.">
              <NativeSelect id="bidTimerSeconds" value={formData.bidTimerSeconds} onChange={(e) => patch({ bidTimerSeconds: Number(e.target.value) })} className={formInputCls}>
                {bidTimerOptions(bidTimerSeconds(currentSettings.settings)).map((sec) => (
                  <option key={sec} value={sec}>{bidTimerLabel(sec)}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Who can bid" htmlFor="bidMode" hint={`${BID_MODE_OPTIONS.find((o) => o.value === formData.bidMode)?.hint} Can change mid-auction.`}>
              <NativeSelect id="bidMode" value={formData.bidMode} onChange={(e) => patch({ bidMode: e.target.value as BidMode })} className={formInputCls}>
                {BID_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </section>
      )}

      {tab === 'registration' && (
        <div className="space-y-4">
          <section>
            <SectionHeading icon={ClipboardList} title="Player Registration" hint="can change any time" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8.5rem]">
              <div className="space-y-3">
                <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-800/40 p-3">
                  <input type="checkbox" checked={formData.registrationOpen} onChange={(e) => patch({ registrationOpen: e.target.checked })} className="mt-0.5 h-4 w-4 accent-blue-600" />
                  <span>
                    <span className="block text-sm font-medium">Open player registration</span>
                    <span className="block text-xs text-slate-400">Players sign up at /register/&lt;tournament&gt;; you approve each one under Registrations.</span>
                  </span>
                </label>
                <Field label="Registration fee (₹, 0 = free)" htmlFor="registrationFee" error={fieldErrors.registrationFee} hint="Players scan your QR and upload a screenshot, or choose to pay you in person.">
                  <Input id="registrationFee" type="number" min="0" step="50" value={formData.registrationFee} onChange={(e) => patch({ registrationFee: e.target.value })} className={`${formInputCls} max-w-48`} />
                </Field>
              </div>
              <Field label="Payment QR">
                <ImageUpload value={formData.paymentQrUrl || undefined} onChange={(url) => patch({ paymentQrUrl: url || '' })} folder="tournaments" aspectRatio="square" />
              </Field>
            </div>
            {!formData.paymentQrUrl && Number(formData.registrationFee) > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-300">
                <QrCode className="h-3.5 w-3.5" /> Add your UPI QR so players can pay when they register.
              </p>
            )}
          </section>

          <FormDivider />

          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <SectionHeading icon={Megaphone} title="Sponsors" hint="shown on the registration form" />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={sponsors.length >= 12}
                onClick={() => setSponsors((prev) => [...prev, { name: '', logoUrl: '' }])}
                className="-mt-3 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
            {sponsors.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-700 p-3 text-center text-xs text-slate-500">No sponsors yet.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {sponsors.map((sp, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/40 p-2">
                    <ImageUpload value={sp.logoUrl || undefined} onChange={(url) => patchSponsor(i, { logoUrl: url || '' })} folder="tournaments" aspectRatio="square" className="w-14 shrink-0 [&_p]:hidden [&_svg]:mb-0 [&_svg]:h-5 [&_svg]:w-5" />
                    <Input value={sp.name} onChange={(e) => patchSponsor(i, { name: e.target.value })} placeholder="Sponsor name" maxLength={60} aria-label={`Sponsor ${i + 1} name`} className={formInputCls} />
                    <button type="button" onClick={() => setSponsors((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove sponsor ${i + 1}`} className="p-1.5 text-slate-400 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {sponsorsError && <p className="mt-2 text-xs text-red-400">{sponsorsError}</p>}
          </section>
        </div>
      )}

      {tab === 'rules' && (
        <AuctionRulesEditor
          value={rules}
          onChange={setRules}
          minBidIncrement={parsed.minBidIncrement || currentSettings.settings.minBidIncrement}
          error={rulesError}
        />
      )}

      {/* Staff changes save straight away; Save Changes still saves the other tabs. */}
      {tab === 'staff' && (
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Adding or removing staff saves immediately. Save Changes saves edits on the other tabs.
          </p>
          <StaffManager tournamentId={tournamentId} />
        </div>
      )}
    </FormModal>
  );
}
