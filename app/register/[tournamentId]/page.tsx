"use client";

import { use, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { Activity, Check, CheckCircle2, ImageUp, QrCode, Tag, Trophy, Upload, UserRound, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Field, FormDivider, SectionHeading, formInputCls } from '@/components/ui/form-modal';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { PLAYER_ROLES, cn, getErrorMessage, getRoleBadgeBg } from '@/lib/utils';
import { openRazorpayCheckout } from '@/lib/razorpayCheckout';

// Same limits as /api/upload.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'] as const;

// "qr": showing the QR, waiting for the screenshot. "offline": paying in person.
type PayStep = 'choose' | 'qr' | 'offline' | 'paid';
type Done = { registrationId?: Id<"registrations">; needsPayment: boolean; fee: number; step: PayStep };

/** Public player registration. No sign-in; the organiser reviews every entry. */
export default function RegisterPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId: raw } = use(params);
  const tournamentId = raw as Id<"tournaments">;
  const info = useQuery(api.registrations.getPublicInfo, { tournamentId });
  const submit = useMutation(api.registrations.submit);
  const submitPaymentProof = useMutation(api.registrations.submitPaymentProof);
  const chooseOfflinePayment = useMutation(api.registrations.chooseOfflinePayment);
  const getUploadSignature = useAction(api.registrations.getUploadSignature);

  const [form, setForm] = useState({
    name: '',
    phoneNumber: '',
    age: '',
    role: [] as string[],
    battingBowlingHand: 'Right-handed' as 'Right-handed' | 'Left-handed',
    jerseyNumber: '',
    jerseyName: '',
    tshirtSize: '' as '' | (typeof TSHIRT_SIZES)[number],
    categoryId: '',
    consentWhatsApp: false,
    website: '', // honeypot: hidden from people, filled by bots
  });
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [uploading, setUploading] = useState<'photo' | 'proof' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [paying, setPaying] = useState(false);

  const patch = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const setStep = (step: PayStep) => setDone((d) => (d ? { ...d, step } : d));

  /** Direct, signed upload to Cloudinary; returns the image URL. */
  const uploadImage = async (file: File): Promise<string | null> => {
    if (!PHOTO_TYPES.includes(file.type)) {
      toast.error('Image must be JPG, PNG or WebP');
      return null;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error('Image must be 5 MB or smaller');
      return null;
    }
    const sig = await getUploadSignature({ tournamentId });
    const body = new FormData();
    body.append('file', file);
    body.append('api_key', sig.apiKey);
    body.append('timestamp', String(sig.timestamp));
    body.append('signature', sig.signature);
    body.append('folder', sig.folder);
    body.append('allowed_formats', sig.allowed_formats);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: 'POST', body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? 'Upload failed');
    return data.secure_url as string;
  };

  const uploadPhoto = async (file: File) => {
    setUploading('photo');
    try {
      const url = await uploadImage(file);
      if (url) setPhotoUrl(url);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Upload failed'));
    } finally {
      setUploading(null);
    }
  };

  const uploadProof = async (file: File) => {
    if (!done?.registrationId) return;
    setUploading('proof');
    try {
      const url = await uploadImage(file);
      if (!url) return;
      await submitPaymentProof({ registrationId: done.registrationId, proofUrl: url });
      setStep('paid');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not upload the screenshot'));
    } finally {
      setUploading(null);
    }
  };

  const payOffline = async () => {
    if (!done?.registrationId) return;
    setPaying(true);
    try {
      await chooseOfflinePayment({ registrationId: done.registrationId });
      setStep('offline');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Something went wrong'));
    } finally {
      setPaying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.role.length === 0) return toast.error('Choose at least one role');
    setSubmitting(true);
    try {
      const res = await submit({
        tournamentId,
        name: form.name,
        phoneNumber: form.phoneNumber,
        age: Number(form.age) || 0,
        role: form.role,
        battingBowlingHand: form.battingBowlingHand,
        jerseyNumber: form.jerseyNumber ? Number(form.jerseyNumber) : undefined,
        jerseyName: form.jerseyName.trim() || undefined,
        tshirtSize: form.tshirtSize || undefined,
        categoryId: form.categoryId || undefined,
        photoUrl,
        consentWhatsApp: form.consentWhatsApp,
        website: form.website,
      });
      setDone({ registrationId: res.registrationId, needsPayment: res.needsPayment, fee: res.fee, step: res.needsPayment ? 'choose' : 'paid' });
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not register'));
    } finally {
      setSubmitting(false);
    }
  };

  // No QR set: fall back to Razorpay, when the platform has it configured.
  const payOnline = async () => {
    if (!done?.registrationId) return;
    setPaying(true);
    try {
      const res = await fetch('/api/registrations/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: done.registrationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not start the payment');
      await openRazorpayCheckout({
        keyId: data.keyId,
        orderId: data.orderId,
        amount: data.amount,
        currency: data.currency,
        description: `Registration · ${info?.name ?? ''}`,
        prefill: { contact: form.phoneNumber, name: form.name },
        onPaid: () => setStep('paid'),
      });
    } catch (error) {
      toast.error(getErrorMessage(error, 'Payment failed'));
    } finally {
      setPaying(false);
    }
  };

  if (info === undefined) {
    return <main className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" aria-label="Loading" /></main>;
  }

  const shell = (children: React.ReactNode) => (
    <main className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10 space-y-5">
        <header className="overflow-hidden rounded-2xl border border-slate-800 bg-linear-to-br from-blue-600/25 via-slate-900 to-purple-600/15">
          <div className="flex flex-col items-center gap-3 px-5 pt-6 pb-5 text-center sm:flex-row sm:text-left">
            <ImgWithFallback
              src={info?.logoUrl}
              alt={`${info?.name ?? 'Tournament'} logo`}
              className="h-24 w-24 shrink-0 rounded-2xl border border-slate-700 bg-slate-900 object-contain shadow-lg"
              fallback={<div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-yellow-500/15"><Trophy className="h-12 w-12 text-yellow-500" /></div>}
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">Player registration</p>
              <h1 className="text-2xl font-extrabold sm:text-3xl">{info?.name ?? 'Tournament'}</h1>
              {info?.description && <p className="mt-1 text-sm text-slate-300 line-clamp-3">{info.description}</p>}
            </div>
          </div>
          {info && info.sponsors.length > 0 && (
            <div className="border-t border-white/10 bg-black/20 px-5 py-3">
              <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-400 sm:text-left">Supported by</p>
              <ul className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                {info.sponsors.map((s) => (
                  <li key={s.name} className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
                    {s.logoUrl && <ImgWithFallback src={s.logoUrl} alt="" className="h-7 w-7 rounded object-contain" fallback={null} />}
                    <span className="text-sm font-medium text-slate-200">{s.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </header>
        {children}
      </div>
    </main>
  );

  if (!info || !info.open) {
    return shell(<p className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-slate-300">Registration isn&apos;t open for this tournament.</p>);
  }

  if (done) {
    const fee = `₹${done.fee.toLocaleString('en-IN')}`;
    return shell(
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4 text-center">
        {done.step === 'paid' && (
          <>
            <CheckCircle2 className="mx-auto w-12 h-12 text-green-400" />
            <h2 className="text-xl font-bold">You&apos;re registered</h2>
            <p className="text-sm text-slate-400">
              {done.needsPayment ? 'Payment received. ' : ''}The organiser will review your entry before the auction.
            </p>
          </>
        )}

        {done.step === 'offline' && (
          <>
            <CheckCircle2 className="mx-auto w-12 h-12 text-green-400" />
            <h2 className="text-xl font-bold">You&apos;re registered</h2>
            <p className="text-sm text-slate-400">Pay the {fee} fee to the organiser in person. Your entry is confirmed once they mark it received.</p>
          </>
        )}

        {done.step === 'choose' && (
          <>
            <Wallet className="mx-auto w-12 h-12 text-blue-400" />
            <h2 className="text-xl font-bold">Almost done: pay the {fee} fee</h2>
            <p className="text-sm text-slate-400">Your entry is saved. The organiser reviews it once the fee is paid.</p>
            <Button onClick={info.paymentQrUrl ? () => setStep('qr') : payOnline} disabled={paying} className="w-full h-11">
              {paying ? 'Opening…' : `Pay ${fee}`}
            </Button>
            <Button variant="outline" onClick={payOffline} disabled={paying} className="w-full h-11 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
              Skip, I&apos;ll pay offline
            </Button>
          </>
        )}

        {done.step === 'qr' && info.paymentQrUrl && (
          <>
            <h2 className="flex items-center justify-center gap-2 text-xl font-bold"><QrCode className="h-5 w-5 text-blue-400" /> Scan to pay {fee}</h2>
            <ImgWithFallback src={info.paymentQrUrl} alt="Payment QR code" className="mx-auto w-64 max-w-full rounded-xl bg-white p-2" fallback={<p className="text-sm text-slate-400">The QR code could not load.</p>} />
            <ol className="mx-auto max-w-sm space-y-1 text-left text-sm text-slate-300">
              <li>1. Scan the QR with any UPI app and pay {fee}.</li>
              <li>2. Take a screenshot of the successful payment.</li>
              <li>3. Upload it below to finish registering.</li>
            </ol>
            <label className={cn('flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700', uploading && 'pointer-events-none opacity-60')}>
              <ImageUp className="h-4 w-4" />
              {uploading === 'proof' ? 'Uploading…' : 'Upload payment screenshot'}
              <input type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" disabled={uploading !== null} onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
            </label>
            <button type="button" onClick={payOffline} disabled={paying || uploading !== null} className="text-sm text-slate-400 underline-offset-2 hover:text-white hover:underline">
              Skip, I&apos;ll pay offline
            </button>
          </>
        )}
      </div>,
    );
  }

  const isLeft = form.battingBowlingHand === 'Left-handed';

  return shell(
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      {info.fee > 0 && (
        <p className="rounded-lg bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
          Registration fee: ₹{info.fee.toLocaleString('en-IN')}, paid after you submit{info.paymentQrUrl ? ' by scanning the organiser’s QR' : ''} or in person.
        </p>
      )}

      <section>
        <SectionHeading icon={UserRound} title="About you" />
        <div className="grid grid-cols-[6.5rem_1fr] gap-4 sm:grid-cols-[8rem_1fr]">
          <div>
            <span className="text-sm font-medium text-slate-300">Photo</span>
            <label className="mt-1.5 flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border-2 border-dashed border-slate-600 text-center text-xs text-slate-400 hover:border-blue-500">
              {photoUrl ? (
                <ImgWithFallback src={photoUrl} alt="Your photo" className="h-full w-full object-cover" fallback={<Upload className="w-5 h-5" />} />
              ) : (
                <>
                  <Upload className="h-6 w-6" />
                  <span>{uploading === 'photo' ? 'Uploading…' : 'Face photo'}</span>
                </>
              )}
              <input type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" disabled={uploading !== null} onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
            </label>
          </div>
          <div className="grid grid-cols-2 content-start gap-3">
            <Field label="Full name *" htmlFor="reg-name" className="col-span-2">
              <Input id="reg-name" required value={form.name} onChange={(e) => patch({ name: e.target.value })} className={formInputCls} autoComplete="name" />
            </Field>
            <Field label="Mobile *" htmlFor="reg-phone">
              <Input id="reg-phone" required inputMode="tel" value={form.phoneNumber} onChange={(e) => patch({ phoneNumber: e.target.value })} placeholder="98765 43210" className={formInputCls} autoComplete="tel" />
            </Field>
            <Field label="Age *" htmlFor="reg-age">
              <Input id="reg-age" required type="number" min="5" max="80" value={form.age} onChange={(e) => patch({ age: e.target.value })} className={formInputCls} />
            </Field>
          </div>
        </div>
      </section>

      <FormDivider />

      <section className="space-y-4">
        <SectionHeading icon={Activity} title="Playing style" />
        <fieldset>
          <legend className="text-sm font-medium text-slate-300">Role *</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLAYER_ROLES.map((r) => {
              const on = form.role.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => patch({ role: on ? form.role.filter((x) => x !== r) : [...form.role, r] })}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition',
                    on ? cn(getRoleBadgeBg(r), 'border-transparent text-white shadow-sm') : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
                  )}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                  {r}
                </button>
              );
            })}
          </div>
        </fieldset>

        {info.categories.length > 0 && (
          <fieldset>
            <legend className="text-sm font-medium text-slate-300">Your category</legend>
            <p className="text-xs text-slate-500">Pick the group you belong to. The organiser can change it.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {info.categories.map((c) => {
                const on = form.categoryId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => patch({ categoryId: on ? '' : c.id })}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition',
                      on ? 'border-blue-500 bg-blue-600 text-white shadow' : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
                    )}
                  >
                    {on ? <Check className="h-3.5 w-3.5" /> : <Tag className="h-3.5 w-3.5 text-slate-500" />}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <div>
          <Label className="text-slate-300">Batting / bowling hand</Label>
          <div className="mt-2 grid max-w-sm grid-cols-2 gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-1">
            {(['Right-handed', 'Left-handed'] as const).map((hand) => {
              const selected = hand === 'Left-handed' ? isLeft : !isLeft;
              return (
                <button
                  key={hand}
                  type="button"
                  onClick={() => patch({ battingBowlingHand: hand })}
                  className={cn('h-9 rounded-md text-sm font-medium transition', selected ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:text-white')}
                >
                  {hand}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="T-shirt size" htmlFor="reg-size">
            <NativeSelect id="reg-size" value={form.tshirtSize} onChange={(e) => patch({ tshirtSize: e.target.value as typeof form.tshirtSize })} className={formInputCls}>
              <option value="">—</option>
              {TSHIRT_SIZES.map((s) => <option key={s}>{s}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Jersey #" htmlFor="reg-jersey">
            <Input id="reg-jersey" type="number" min="1" max="99" value={form.jerseyNumber} onChange={(e) => patch({ jerseyNumber: e.target.value })} className={formInputCls} />
          </Field>
          <Field label="Name on jersey" htmlFor="reg-jname">
            <Input id="reg-jname" value={form.jerseyName} onChange={(e) => patch({ jerseyName: e.target.value })} className={cn(formInputCls, 'uppercase')} />
          </Field>
        </div>
      </section>

      {/* Honeypot: off-screen and skipped by keyboards and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => patch({ website: e.target.value })} /></label>
      </div>

      <FormDivider />

      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={form.consentWhatsApp} onChange={(e) => patch({ consentWhatsApp: e.target.checked })} className="mt-1 accent-blue-600" />
        <span>I agree to get WhatsApp messages about this tournament from the organiser and Bid11Pro, such as which team bought me.</span>
      </label>
      <p className="text-xs text-slate-500">Your phone number is only shared with the organiser.</p>

      <Button type="submit" disabled={submitting || uploading !== null} className="w-full h-11">
        {submitting ? 'Submitting…' : 'Register'}
      </Button>
    </form>,
  );
}
