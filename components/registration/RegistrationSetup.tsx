"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Doc, Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { AmountInput } from '@/components/ui/amount-input';
import { ImageUpload } from '@/components/ui/image-upload';
import { RegistrationHeader } from '@/components/registration/RegistrationHeader';
import { formatRupees } from '@/convex/bidRules';
import { cn, getErrorMessage } from '@/lib/utils';

const MAX_FEE = 100_000; // MAX_REGISTRATION_FEE in convex/validation.ts

const feeText = (fee: number) => (fee > 0 ? formatRupees(fee) : 'free');

type Tournament = Pick<Doc<"tournaments">, "_id" | "name" | "description" | "logoUrl" | "organizationLogoUrl" | "status"> & {
  settings: Pick<Doc<"tournaments">["settings"], "registrationFee" | "coupleRegistrationFee" | "format" | "paymentQrUrl" | "oneRegistrationPerDevice">;
};

/**
 * Free or paid registration. Saving a paid fee needs a whole-rupee amount.
 * Couple tournaments set two fees: one for a couple entry, one for a solo
 * entry (either may be 0, not both).
 */
export function RegistrationFeeCard({ tournament }: { tournament: Tournament }) {
  const setFee = useMutation(api.tournaments.setRegistrationFee);
  const couple = tournament.settings.format === 'couple';
  const savedFee = tournament.settings.registrationFee ?? 0;
  // Absent = couples pay the solo fee (registrationFeeFor in convex/validation.ts).
  const savedCoupleFee = couple ? (tournament.settings.coupleRegistrationFee ?? savedFee) : 0;
  const savedPaid = savedFee > 0 || savedCoupleFee > 0;
  const [paid, setPaid] = useState(savedPaid);
  const [amount, setAmount] = useState<number | undefined>(savedPaid ? savedFee : undefined);
  const [coupleAmount, setCoupleAmount] = useState<number | undefined>(savedPaid ? savedCoupleFee : undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = tournament.status === 'completed';

  const draftFee = paid ? amount : 0;
  const draftCoupleFee = paid ? coupleAmount : 0;
  const dirty = draftFee !== savedFee || (couple && draftCoupleFee !== savedCoupleFee);

  const save = async () => {
    const amounts = couple ? [amount, coupleAmount] : [amount];
    if (paid && amounts.some((a) => a === undefined)) {
      setError(couple ? 'Enter both fees in rupees (0 for free), or choose Free.' : 'Enter the fee in rupees, or choose Free.');
      return;
    }
    if (paid && amounts.some((a) => !Number.isInteger(a) || a! < 0 || a! > MAX_FEE)) {
      setError(`A fee must be whole rupees, up to ${formatRupees(MAX_FEE)}.`);
      return;
    }
    if (paid && amounts.every((a) => a === 0)) {
      setError(couple ? 'Set at least one fee above ₹0, or choose Free.' : 'Enter the fee in rupees, or choose Free.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const fee = paid ? amount! : 0;
      const coupleFee = paid ? coupleAmount! : 0;
      await setFee({ tournamentId: tournament._id, fee, ...(couple ? { coupleFee } : {}) });
      toast.success(
        !paid
          ? 'Registration is now free'
          : couple
            ? `Fees set: couple ${feeText(coupleFee)}, solo ${feeText(fee)}`
            : `Registration fee set to ${formatRupees(fee)}`,
      );
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save the fee'));
    } finally {
      setSaving(false);
    }
  };

  const option = (value: boolean, title: string, body: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={paid === value}
      disabled={locked}
      onClick={() => {
        setPaid(value);
        setError(null);
      }}
      className={cn(
        'min-h-11 flex-1 rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50',
        paid === value ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-900 hover:border-slate-500',
      )}
    >
      <span className="block font-semibold">{title}</span>
      <span className="block text-xs text-slate-400">{body}</span>
    </button>
  );

  return (
    <section aria-labelledby="fee-title" className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
      <div>
        <h2 id="fee-title" className="text-lg font-semibold">Registration fee</h2>
        <p className="text-sm text-slate-400">Free registrations go straight to review. Paid ones wait for the fee first.</p>
      </div>
      <div role="radiogroup" aria-labelledby="fee-title" className="flex flex-col gap-2 sm:flex-row">
        {option(false, 'Free', 'No fee. Approving is one tap.')}
        {option(true, 'Paid', 'Players pay online, by your UPI QR, or in person.')}
      </div>
      {paid && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-3">
            {couple && (
              <div className="space-y-1">
                <label htmlFor="couple-fee-amount" className="block text-sm text-slate-300">Couple fee (₹)</label>
                <AmountInput
                  id="couple-fee-amount"
                  value={coupleAmount}
                  onValueChange={(v) => {
                    setCoupleAmount(v);
                    setError(null);
                  }}
                  disabled={locked}
                  placeholder="e.g. 800"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'fee-error' : 'fee-hint'}
                  className="max-w-48"
                />
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="fee-amount" className="block text-sm text-slate-300">{couple ? 'Solo fee (₹)' : 'Fee (₹)'}</label>
              <AmountInput
                id="fee-amount"
                value={amount}
                onValueChange={(v) => {
                  setAmount(v);
                  setError(null);
                }}
                disabled={locked}
                placeholder="e.g. 500"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'fee-error' : 'fee-hint'}
                className="max-w-48"
              />
            </div>
          </div>
          {couple && <p className="text-xs text-slate-500">A couple registers together and pays once. Enter 0 to make one of them free.</p>}
          <p id="fee-hint" className="text-xs text-slate-500">
            {tournament.settings.paymentQrUrl ? 'Your UPI QR is shown on the form.' : 'Add a UPI QR in Settings to let players pay by scanning it.'}
          </p>
        </div>
      )}
      {error && <p id="fee-error" role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="button" className="min-h-11" disabled={!dirty || saving || locked} onClick={save}>
          {saving ? 'Saving…' : 'Save fee'}
        </Button>
        <span className="text-xs text-slate-500" aria-live="polite">
          {locked
            ? 'Completed tournaments can’t change.'
            : dirty
              ? 'Not saved yet'
              : `Saved: ${!savedPaid ? 'Free' : couple ? `couple ${feeText(savedCoupleFee)}, solo ${feeText(savedFee)}` : formatRupees(savedFee)}`}
        </span>
      </div>
    </section>
  );
}

/** One registration per device (browser), or any number. Saves on change. */
export function RegistrationDeviceCard({ tournament }: { tournament: Tournament }) {
  const setOnePerDevice = useMutation(api.tournaments.setOneRegistrationPerDevice);
  const enabled = tournament.settings.oneRegistrationPerDevice === true;
  const [saving, setSaving] = useState(false);
  const locked = tournament.status === 'completed';

  const toggle = async () => {
    setSaving(true);
    try {
      await setOnePerDevice({ tournamentId: tournament._id, enabled: !enabled });
      toast.success(!enabled ? 'One registration per device is on' : 'Any number of registrations per device');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not save the setting'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="device-title" className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="device-title" className="text-lg font-semibold">One registration per device</h2>
          <p id="device-hint" className="text-sm text-slate-400">
            Stops one phone from registering several players. Leave it off if captains or parents register players for others.
            It is a deterrent, not proof: a private tab or another browser counts as a new device.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="device-title"
          aria-describedby="device-hint"
          disabled={saving || locked}
          onClick={toggle}
          className={cn(
            'relative mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
            enabled ? 'bg-blue-600' : 'bg-slate-700',
          )}
        >
          <span className={cn('inline-block h-5 w-5 rounded-full bg-white transition-transform', enabled ? 'translate-x-6' : 'translate-x-1')} />
        </button>
      </div>
      {locked && <p className="text-xs text-slate-500">Completed tournaments can’t change.</p>}
    </section>
  );
}

/** The tournament and organisation logos at the top of the form, with a live preview. */
export function RegistrationLogosCard({ tournament }: { tournament: Tournament }) {
  const update = useMutation(api.tournaments.update);
  const [saving, setSaving] = useState<'logo' | 'org' | null>(null);
  const locked = tournament.status === 'completed';

  const save = async (which: 'logo' | 'org', url: string | undefined) => {
    setSaving(which);
    try {
      await update(
        which === 'logo'
          ? { id: tournament._id as Id<"tournaments">, logoUrl: url ?? '' }
          : { id: tournament._id as Id<"tournaments">, organizationLogoUrl: url ?? '' },
      );
      toast.success(url ? 'Logo saved' : 'Logo removed');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not save the logo'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section aria-labelledby="logos-title" className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
      <div>
        <h2 id="logos-title" className="text-lg font-semibold">Form header</h2>
        <p className="text-sm text-slate-400">
          The tournament logo sits on the left and your organisation&apos;s logo on the right. Square images look best (JPG, PNG or WebP, up to 4 MB).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-sm text-slate-300">Tournament logo</p>
          <ImageUpload
            value={tournament.logoUrl || undefined}
            onChange={(url) => save('logo', url)}
            folder="tournaments"
            disabled={locked || saving !== null}
            className="max-w-36"
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm text-slate-300">Organisation logo</p>
          <ImageUpload
            value={tournament.organizationLogoUrl || undefined}
            onChange={(url) => save('org', url)}
            folder="tournaments"
            disabled={locked || saving !== null}
            className="max-w-36"
          />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Preview</p>
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-linear-to-br from-blue-600/25 via-slate-900 to-purple-600/15 text-white">
          <RegistrationHeader
            name={tournament.name}
            description={tournament.description}
            logoUrl={tournament.logoUrl || undefined}
            organizationLogoUrl={tournament.organizationLogoUrl}
          />
        </div>
      </div>
    </section>
  );
}
