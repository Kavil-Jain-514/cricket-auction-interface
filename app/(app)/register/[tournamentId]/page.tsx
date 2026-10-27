"use client";

import { use, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { CheckCircle2, Trophy, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { PLAYER_ROLES, getErrorMessage } from '@/lib/utils';
import { openRazorpayCheckout } from '@/lib/razorpayCheckout';

// Same limits as /api/upload.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'] as const;

type Done = { registrationId?: Id<"registrations">; needsPayment: boolean; fee: number; paid?: boolean };

const fieldCls = 'mt-1 h-11 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-white';

/** Public player registration. No sign-in; the organiser reviews every entry. */
export default function RegisterPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId: raw } = use(params);
  const tournamentId = raw as Id<"tournaments">;
  const info = useQuery(api.registrations.getPublicInfo, { tournamentId });
  const submit = useMutation(api.registrations.submit);
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
    consentWhatsApp: false,
    website: '', // honeypot: hidden from people, filled by bots
  });
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [paying, setPaying] = useState(false);

  const patch = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const uploadPhoto = async (file: File) => {
    if (!PHOTO_TYPES.includes(file.type)) return toast.error('Photo must be JPG, PNG or WebP');
    if (file.size > MAX_PHOTO_BYTES) return toast.error('Photo must be 5 MB or smaller');
    setUploading(true);
    try {
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
      setPhotoUrl(data.secure_url);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Upload failed'));
    } finally {
      setUploading(false);
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
        photoUrl,
        consentWhatsApp: form.consentWhatsApp,
        website: form.website,
      });
      setDone({ registrationId: res.registrationId, needsPayment: res.needsPayment, fee: res.fee });
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not register'));
    } finally {
      setSubmitting(false);
    }
  };

  const pay = async () => {
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
        onPaid: () => setDone((d) => (d ? { ...d, paid: true } : d)),
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
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-xl px-4 py-8 space-y-6">
        <header className="flex items-center gap-3">
          <ImgWithFallback src={info?.logoUrl} alt="" className="w-14 h-14 rounded-xl object-contain bg-slate-900 border border-slate-700" fallback={<div className="w-14 h-14 rounded-xl bg-yellow-500/15 flex items-center justify-center"><Trophy className="w-7 h-7 text-yellow-500" /></div>} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Player registration</p>
            <h1 className="text-2xl font-extrabold">{info?.name ?? 'Tournament'}</h1>
          </div>
        </header>
        {children}
      </div>
    </main>
  );

  if (!info || !info.open) {
    return shell(<p className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-slate-300">Registration isn&apos;t open for this tournament.</p>);
  }

  if (done) {
    return shell(
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-3 text-center">
        <CheckCircle2 className="mx-auto w-12 h-12 text-green-400" />
        {done.needsPayment && !done.paid ? (
          <>
            <h2 className="text-xl font-bold">Almost done: pay the ₹{done.fee.toLocaleString('en-IN')} fee</h2>
            <p className="text-sm text-slate-400">Your entry is saved. The organiser reviews it once the fee is paid.</p>
            <Button onClick={pay} disabled={paying} className="w-full h-11">{paying ? 'Opening…' : `Pay ₹${done.fee.toLocaleString('en-IN')}`}</Button>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold">You&apos;re registered</h2>
            <p className="text-sm text-slate-400">The organiser will review your entry before the auction.</p>
          </>
        )}
      </div>,
    );
  }

  return shell(
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
      {info.fee > 0 && <p className="rounded-lg bg-blue-500/10 px-3 py-2 text-sm text-blue-200">Registration fee: ₹{info.fee.toLocaleString('en-IN')}, paid online after you submit.</p>}

      <div>
        <Label htmlFor="reg-name">Full name *</Label>
        <Input id="reg-name" required value={form.name} onChange={(e) => patch({ name: e.target.value })} className="mt-1 h-11" autoComplete="name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="reg-phone">Mobile number *</Label>
          <Input id="reg-phone" required inputMode="tel" value={form.phoneNumber} onChange={(e) => patch({ phoneNumber: e.target.value })} placeholder="98765 43210" className="mt-1 h-11" autoComplete="tel" />
        </div>
        <div>
          <Label htmlFor="reg-age">Age *</Label>
          <Input id="reg-age" required type="number" min="5" max="80" value={form.age} onChange={(e) => patch({ age: e.target.value })} className="mt-1 h-11" />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Role *</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {PLAYER_ROLES.map((r) => {
            const on = form.role.includes(r);
            return (
              <button key={r} type="button" aria-pressed={on} onClick={() => patch({ role: on ? form.role.filter((x) => x !== r) : [...form.role, r] })} className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'border-blue-500 bg-blue-500/20 text-white' : 'border-slate-600 text-slate-300'}`}>
                {r}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="reg-hand">Batting / bowling hand</Label>
          <select id="reg-hand" value={form.battingBowlingHand} onChange={(e) => patch({ battingBowlingHand: e.target.value as 'Right-handed' | 'Left-handed' })} className={fieldCls}>
            <option>Right-handed</option>
            <option>Left-handed</option>
          </select>
        </div>
        <div>
          <Label htmlFor="reg-size">T-shirt size</Label>
          <select id="reg-size" value={form.tshirtSize} onChange={(e) => patch({ tshirtSize: e.target.value as typeof form.tshirtSize })} className={fieldCls}>
            <option value="">—</option>
            {TSHIRT_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="reg-jersey">Jersey number</Label>
          <Input id="reg-jersey" type="number" min="1" max="99" value={form.jerseyNumber} onChange={(e) => patch({ jerseyNumber: e.target.value })} className="mt-1 h-11" />
        </div>
        <div>
          <Label htmlFor="reg-jname">Name on jersey</Label>
          <Input id="reg-jname" value={form.jerseyName} onChange={(e) => patch({ jerseyName: e.target.value })} className="mt-1 h-11 uppercase" />
        </div>
      </div>

      <div>
        <span className="text-sm font-medium">Photo</span>
        <label className="mt-1 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-600 p-3 text-sm text-slate-300 hover:border-blue-500">
          {photoUrl ? <ImgWithFallback src={photoUrl} alt="Your photo" className="h-14 w-14 rounded-lg object-cover" fallback={<Upload className="w-5 h-5" />} /> : <Upload className="w-5 h-5" />}
          <span>{uploading ? 'Uploading…' : photoUrl ? 'Change photo' : 'Upload a clear face photo (JPG, PNG or WebP, up to 5 MB)'}</span>
          <input type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" disabled={uploading} onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
        </label>
      </div>

      {/* Honeypot: off-screen and skipped by keyboards and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => patch({ website: e.target.value })} /></label>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={form.consentWhatsApp} onChange={(e) => patch({ consentWhatsApp: e.target.checked })} className="mt-1" />
        <span>I agree to get WhatsApp messages about this tournament from the organiser and Bid11Pro, such as which team bought me.</span>
      </label>
      <p className="text-xs text-slate-500">Your phone number is only shared with the organiser.</p>

      <Button type="submit" disabled={submitting || uploading} className="w-full h-11">
        {submitting ? 'Submitting…' : 'Register'}
      </Button>
    </form>,
  );
}
