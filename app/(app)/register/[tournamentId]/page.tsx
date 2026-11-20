"use client";

import { use, useRef, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { Activity, Check, CheckCircle2, ClipboardList, ImageUp, QrCode, Tag, Upload, UserRound, Wallet } from 'lucide-react';
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
import { retryWhenBusy } from '@/lib/retryWhenBusy';
import { getDeviceId } from '@/lib/deviceId';
import { formatRupees } from '@/convex/bidRules';
import { DEFAULT_REQUIRED_FIELDS, missingRequiredField, validateAnswers, type StandardField } from '@/convex/registrationForm';
import { CustomQuestions, answersToSubmit, type AnswerMap } from '@/components/registration/CustomQuestions';
import { SponsorBand } from '@/components/registration/SponsorBand';
import { RegistrationHeader } from '@/components/registration/RegistrationHeader';

// Same limits as /api/upload.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'] as const;

// "qr": showing the QR, waiting for the screenshot. "offline": paying in person.
// "saved": an earlier attempt whose answer was lost turned out to have been
// saved, so there is no registration id to pay against here.
type PayStep = 'choose' | 'qr' | 'offline' | 'paid' | 'saved';

const BUSY_NOTE = 'Lots of people are registering right now, you are in line. Retrying…';

/** Cloudinary upload, tried once more on a network failure or a 5xx. */
async function postToCloudinary(url: string, body: FormData): Promise<Response> {
  try {
    const res = await fetch(url, { method: 'POST', body });
    if (res.status < 500) return res;
  } catch {
    // Network failure: fall through to the one retry.
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return await fetch(url, { method: 'POST', body });
}
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
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<'photo' | 'proof' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [paying, setPaying] = useState(false);
  // Shown (and announced) while a busy refusal is being retried.
  const [busyNote, setBusyNote] = useState<string | null>(null);
  // Blocks a second submit before the disabled button has rendered.
  const submittingRef = useRef(false);
  // name|phone of a submit whose outcome is unknown (the connection failed
  // after sending). If the retry says "already registered", it was saved.
  const uncertainSubmit = useRef<string | null>(null);

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
    let sig;
    try {
      sig = await retryWhenBusy(() => getUploadSignature({ tournamentId }), { onRetry: () => setBusyNote(BUSY_NOTE) });
    } finally {
      setBusyNote(null);
    }
    const body = new FormData();
    body.append('file', file);
    body.append('api_key', sig.apiKey);
    body.append('timestamp', String(sig.timestamp));
    body.append('signature', sig.signature);
    body.append('folder', sig.folder);
    // The signature is for this one file name; the server only accepts a
    // registration's upload if it matches a name it signed.
    body.append('public_id', sig.public_id);
    body.append('allowed_formats', sig.allowed_formats);
    // Same signature on the retry: it names this one file, so a first try that
    // did land is simply overwritten.
    const res = await postToCloudinary(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, body);
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
    // The organiser's required standard details: the same check the server runs.
    const missing = missingRequiredField(
      required,
      {
        photoUrl,
        age: form.age.trim() ? Number(form.age) : undefined,
        role: form.role,
        categoryId: form.categoryId || undefined,
        tshirtSize: form.tshirtSize || undefined,
        jerseyNumber: form.jerseyNumber ? Number(form.jerseyNumber) : undefined,
        jerseyName: form.jerseyName,
      },
      { hasCategories: categories.length > 0 },
    );
    if (missing) return toast.error(missing);
    // The organiser's questions: the same check the server runs.
    const customForm = info?.form ?? null;
    const values = customForm ? answersToSubmit(customForm.questions, answers) : [];
    if (customForm) {
      const { errors } = validateAnswers(customForm.questions, values);
      setAnswerErrors(Object.fromEntries(errors.map((err) => [err.questionId, err.message])));
      if (errors.length > 0) {
        document.getElementById(`cq-${errors[0].questionId}`)?.focus();
        return toast.error(errors[0].message);
      }
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    const person = `${form.name.trim().toLowerCase()}|${form.phoneNumber.replace(/\D/g, '').slice(-10)}`;
    try {
      const res = await retryWhenBusy(() => submit({
        tournamentId,
        name: form.name,
        phoneNumber: form.phoneNumber,
        age: form.age.trim() ? Number(form.age) : undefined,
        role: form.role,
        battingBowlingHand: form.battingBowlingHand,
        jerseyNumber: form.jerseyNumber ? Number(form.jerseyNumber) : undefined,
        jerseyName: form.jerseyName.trim() || undefined,
        tshirtSize: form.tshirtSize || undefined,
        categoryId: form.categoryId || undefined,
        photoUrl,
        consentWhatsApp: form.consentWhatsApp,
        answers: customForm ? { formVersion: customForm.version, values } : undefined,
        deviceId: getDeviceId(),
        website: form.website,
      }), { onRetry: () => setBusyNote(BUSY_NOTE) });
      uncertainSubmit.current = null;
      setDone({ registrationId: res.registrationId, needsPayment: res.needsPayment, fee: res.fee, step: res.needsPayment ? 'choose' : 'paid' });
    } catch (error) {
      const message = getErrorMessage(error, 'Could not register');
      if (uncertainSubmit.current === person && /is already registered for this tournament$/.test(message)) {
        // Our earlier attempt reached the server; its answer was lost on the way back.
        uncertainSubmit.current = null;
        setDone({ needsPayment: info?.fee ? info.fee > 0 : false, fee: info?.fee ?? 0, step: 'saved' });
      } else {
        // A ConvexError is the server's answer (nothing was saved). Anything
        // else may have been lost after the server saved the entry.
        if (!(error instanceof ConvexError)) uncertainSubmit.current = person;
        toast.error(message);
      }
    } finally {
      setBusyNote(null);
      submittingRef.current = false;
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

  // Older deployments return no categories or sponsors.
  const categories = info?.categories ?? [];
  const required = info?.requiredFields ?? DEFAULT_REQUIRED_FIELDS;
  /** "Age *" when the organiser requires it, plain "Age" otherwise. */
  const label = (text: string, field: StandardField) => (required[field] ? `${text} *` : text);
  const sponsors = info?.sponsors ?? [];

  if (info === undefined) {
    return <main className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" aria-label="Loading" /></main>;
  }

  const shell = (children: React.ReactNode) => (
    <main className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10 space-y-5">
        <header className="overflow-hidden rounded-2xl border border-slate-800 bg-linear-to-br from-blue-600/25 via-slate-900 to-purple-600/15">
          <RegistrationHeader
            name={info?.name ?? 'Tournament'}
            description={info?.description}
            logoUrl={info?.logoUrl}
            organizationLogoUrl={info?.organizationLogoUrl}
          />
          <SponsorBand sponsors={sponsors} />
        </header>
        {children}
      </div>
    </main>
  );

  if (!info || !info.open) {
    return shell(<p className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-slate-300">Registration isn&apos;t open for this tournament.</p>);
  }

  if (done) {
    const fee = formatRupees(done.fee);
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

        {done.step === 'saved' && (
          <>
            <CheckCircle2 className="mx-auto w-12 h-12 text-green-400" />
            <h2 className="text-xl font-bold">You&apos;re registered</h2>
            <p className="text-sm text-slate-400">
              Your entry was saved on an earlier try.{' '}
              {done.needsPayment ? `If you haven't paid the ${fee} fee yet, pay the organiser; they'll mark it received. ` : ''}
              The organiser will review your entry before the auction.
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
      {info.onePerDevice && (
        <p className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300">
          One registration per phone for this tournament. To register someone else, use their phone.
        </p>
      )}
      {info.fee > 0 && (
        <p className="rounded-lg bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
          Registration fee: {formatRupees(info.fee)}, paid after you submit{info.paymentQrUrl ? ' by scanning the organiser’s QR' : ''} or in person.
        </p>
      )}

      <section>
        <SectionHeading icon={UserRound} title="About you" />
        <div className="grid grid-cols-[6.5rem_1fr] gap-4 sm:grid-cols-[8rem_1fr]">
          <div>
            <span className="text-sm font-medium text-slate-300">{label('Photo', 'photo')}</span>
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
            <Field label={label('Age', 'age')} htmlFor="reg-age">
              <Input id="reg-age" required={required.age} type="number" min="5" max="80" value={form.age} onChange={(e) => patch({ age: e.target.value })} className={formInputCls} />
            </Field>
          </div>
        </div>
      </section>

      <FormDivider />

      <section className="space-y-4">
        <SectionHeading icon={Activity} title="Playing style" />
        <fieldset>
          <legend className="text-sm font-medium text-slate-300">{label('Role', 'role')}</legend>
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
                    'inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition',
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

        {categories.length > 0 && (
          <fieldset>
            <legend className="text-sm font-medium text-slate-300">{label('Your category', 'category')}</legend>
            <p className="text-xs text-slate-500">Pick the group you belong to. The organiser can change it.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {categories.map((c) => {
                const on = form.categoryId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => patch({ categoryId: on ? '' : c.id })}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition',
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
                  className={cn('h-11 rounded-md text-sm font-medium transition', selected ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:text-white')}
                >
                  {hand}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label={label('T-shirt size', 'tshirtSize')} htmlFor="reg-size">
            <NativeSelect id="reg-size" required={required.tshirtSize} value={form.tshirtSize} onChange={(e) => patch({ tshirtSize: e.target.value as typeof form.tshirtSize })} className={formInputCls}>
              <option value="">—</option>
              {TSHIRT_SIZES.map((s) => <option key={s}>{s}</option>)}
            </NativeSelect>
          </Field>
          <Field label={label('Jersey #', 'jerseyNumber')} htmlFor="reg-jersey">
            <Input id="reg-jersey" required={required.jerseyNumber} type="number" min="1" max="99" value={form.jerseyNumber} onChange={(e) => patch({ jerseyNumber: e.target.value })} className={formInputCls} />
          </Field>
          <Field label={label('Name on jersey', 'jerseyName')} htmlFor="reg-jname">
            <Input id="reg-jname" required={required.jerseyName} value={form.jerseyName} onChange={(e) => patch({ jerseyName: e.target.value })} className={cn(formInputCls, 'uppercase')} />
          </Field>
        </div>
      </section>

      {info.form && info.form.questions.length > 0 && (
        <>
          <FormDivider />
          <section className="space-y-4">
            <SectionHeading icon={ClipboardList} title="More details" />
            <CustomQuestions
              questions={info.form.questions}
              answers={answers}
              errors={answerErrors}
              onChange={(id, value) => {
                setAnswers((a) => ({ ...a, [id]: value }));
                setAnswerErrors(({ [id]: _cleared, ...rest }) => rest);
              }}
              uploadFile={uploadImage}
            />
          </section>
        </>
      )}

      {/* Honeypot: off-screen and skipped by keyboards and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => patch({ website: e.target.value })} /></label>
      </div>

      <FormDivider />

      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={form.consentWhatsApp} onChange={(e) => patch({ consentWhatsApp: e.target.checked })} className="mt-1 accent-blue-600" />
        <span>Send me WhatsApp updates on this number: that I&apos;m registered, when I&apos;m approved, and which team bought me.</span>
      </label>
      <p className="text-xs text-slate-400">Your phone number is only shared with the organiser. Reply STOP on WhatsApp at any time to stop the messages.</p>

      <p role="status" aria-live="polite" className={cn('rounded-lg bg-blue-500/10 px-3 py-2 text-sm text-blue-200', !busyNote && 'sr-only')}>
        {busyNote ?? ''}
      </p>
      <Button type="submit" disabled={submitting || uploading !== null} className="w-full h-11">
        {submitting ? 'Submitting…' : 'Register'}
      </Button>
    </form>,
  );
}
