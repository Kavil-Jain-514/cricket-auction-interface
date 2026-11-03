"use client";

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, Copy, AlertTriangle, ImageIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTournamentRole } from '@/hooks/useTournamentRole';
import { getErrorMessage, getRoleDisplay } from '@/lib/utils';

type Status = 'pending_payment' | 'paid' | 'approved' | 'rejected';
const FILTERS: Array<{ key: Status | 'all'; label: string }> = [
  { key: 'paid', label: 'Ready for review' },
  { key: 'pending_payment', label: 'Awaiting payment' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];
const PAYMENT_LABEL = { razorpay: 'paid online', qr: 'paid by QR', offline: 'paying offline' } as const;
const STATUS_LABEL: Record<Status, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Ready',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** Owner review of self-registrations: approve (creates the player) or reject. */
export default function RegistrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const { canManage, isLoading } = useTournamentRole(tournamentId);
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const rows = useQuery(api.registrations.list, canManage ? { tournamentId } : 'skip');
  const approve = useMutation(api.registrations.approve);
  const reject = useMutation(api.registrations.reject);
  const bulkApprove = useMutation(api.registrations.bulkApprove);
  const markPaid = useMutation(api.registrations.markPaid);
  const setCategory = useMutation(api.registrations.setCategory);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const categories = [...(tournament?.settings.categories ?? [])].sort((a, b) => a.order - b.order);
  const confirm = useConfirm();
  const [filter, setFilter] = useState<Status | 'all'>('paid');
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: Id<"registrations">; name: string } | null>(null);
  const [reason, setReason] = useState('');

  const shown = useMemo(() => (rows ?? []).filter((r) => filter === 'all' || r.status === filter), [rows, filter]);
  const readyCount = (rows ?? []).filter((r) => r.status === 'paid').length;
  const link = typeof window !== 'undefined' ? `${window.location.origin}/register/${tournamentId}` : '';

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Something went wrong'));
    } finally {
      setBusy(null);
    }
  };

  const handleBulk = async () => {
    if (!(await confirm({ title: `Approve all ${readyCount} ready registrations?`, description: 'Each becomes a pending player. Duplicates and plan limits are still checked.', confirmText: 'Approve all' }))) return;
    setBusy('bulk');
    try {
      const res = await bulkApprove({ tournamentId });
      toast.success(`${res.approved} approved`);
      for (const f of res.failed) toast.error(`${f.name}: ${f.reason}`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Bulk approve failed'));
    } finally {
      setBusy(null);
    }
  };

  if (!isLoading && !canManage) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <p className="px-4 py-24 text-center text-slate-400">Only the tournament&apos;s owners can review registrations.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8 space-y-5">
        <Link href={`/tournament/${tournamentId}`} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> {tournament?.name ?? 'Tournament'}
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Registrations</h1>
            <p className="text-sm text-slate-400">
              Registration is {tournament?.settings.registrationOpen ? 'open' : 'closed'}
              {tournament?.settings.registrationFee ? ` · fee ₹${tournament.settings.registrationFee.toLocaleString('en-IN')}` : ' · free'}. Change it in Settings.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Registration link copied'))}
              className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
            >
              <Copy className="w-4 h-4" /> Copy form link
            </Button>
            <Button onClick={handleBulk} disabled={readyCount === 0 || busy !== null}>Approve all ready ({readyCount})</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)} className={`rounded-full px-3 py-1.5 text-sm ${filter === f.key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>
              {f.label}
            </button>
          ))}
        </div>

        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
          {shown.map((r) => (
            <li key={r._id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.name}</span>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{STATUS_LABEL[r.status]}</span>
                  {r.duplicate && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                      <AlertTriangle className="w-3 h-3" /> Possible duplicate
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  {getRoleDisplay(r.role)} · {r.age} yrs · {r.phoneNumber}
                  {r.consentWhatsApp ? ' · WhatsApp OK' : ''}
                  {r.paymentMethod ? ` · ${PAYMENT_LABEL[r.paymentMethod]}` : ''}
                  {r.paymentRef ? ` (${r.paymentRef})` : ''}
                  {r.rejectReason ? ` · ${r.rejectReason}` : ''}
                </div>
              </div>
              {r.paymentProofUrl && (
                <Button size="sm" variant="outline" onClick={() => setProofUrl(r.paymentProofUrl!)} className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
                  <ImageIcon className="w-4 h-4" /> Screenshot
                </Button>
              )}
              {categories.length > 0 && r.status !== 'approved' && r.status !== 'rejected' && (
                <NativeSelect
                  aria-label={`Category for ${r.name}`}
                  value={r.categoryId ?? ''}
                  disabled={busy !== null}
                  onChange={(e) => run(r._id, () => setCategory({ registrationId: r._id, categoryId: e.target.value || undefined }), 'Category updated')}
                  className="h-8 w-40"
                >
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </NativeSelect>
              )}
              {(r.status === 'paid' || r.status === 'pending_payment') && (
                <div className="flex gap-2">
                  {r.status === 'pending_payment' && (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(r._id, () => markPaid({ registrationId: r._id }), `${r.name}'s fee marked received`)} className="border-green-700 bg-green-900/30 text-green-300 hover:bg-green-800/50 hover:text-white">
                      Mark paid
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { setReason(''); setRejecting({ id: r._id, name: r.name }); }} className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
                    Reject
                  </Button>
                  <Button size="sm" disabled={busy !== null || r.status !== 'paid'} title={r.status !== 'paid' ? 'Waiting for the fee' : undefined} onClick={() => run(r._id, () => approve({ registrationId: r._id }), `${r.name} added as a player`)}>
                    Approve
                  </Button>
                </div>
              )}
            </li>
          ))}
          {rows && shown.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Nothing here.</li>}
          {rows === undefined && <li className="p-6 text-center text-sm text-slate-500">Loading…</li>}
        </ul>
      </main>

      {proofUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setProofUrl(null)}>
          <div role="dialog" aria-modal="true" aria-label="Payment screenshot" className="relative max-h-[90dvh] w-full max-w-md overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-3" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setProofUrl(null)} aria-label="Close" className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-slate-200 hover:text-white">
              <X className="w-4 h-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proofUrl} alt="Payment screenshot" className="max-h-[80dvh] w-full rounded-lg object-contain" />
            <p className="mt-2 text-center text-xs text-slate-400">Check the amount and payee before approving.</p>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setRejecting(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="reject-title" className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 id="reject-title" className="mb-3 text-lg font-bold">Reject {rejecting.name}?</h2>
            <label htmlFor="reject-reason" className="text-xs text-slate-400">Reason (kept on the registration)</label>
            <textarea id="reject-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoFocus className="mt-1 min-h-20 w-full rounded-md border border-slate-600 bg-slate-800 p-2 text-sm text-white" />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejecting(null)} className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">Cancel</Button>
              <Button
                variant="destructive"
                disabled={!reason.trim() || busy !== null}
                onClick={() => run(rejecting.id, async () => { await reject({ registrationId: rejecting.id, reason }); setRejecting(null); }, `${rejecting.name} rejected`)}
              >
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
