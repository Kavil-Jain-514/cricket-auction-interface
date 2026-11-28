"use client";

import type { FunctionReturnType } from 'convex/server';
import { AlertTriangle, ClipboardList, ImageIcon, ReceiptText } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { formatRupees } from '@/convex/bidRules';
import { formatAnswer } from '@/lib/registrationsWorkbook';
import { formatSaleTime } from '@/lib/resultsWorkbook';
import { PlayerProfileShell } from '@/components/players/PlayerProfileShell';
import { CoupleDetails } from '@/components/players/CoupleDetails';
import { GENDER_LABEL } from '@/lib/couple';

type Registration = FunctionReturnType<typeof api.registrations.list>[number];
type Labels = Partial<NonNullable<FunctionReturnType<typeof api.registrationForms.get>>['labels']>;

const STATUS_BADGE: Record<Registration['status'], { label: string; className: string }> = {
  pending_payment: { label: 'Awaiting payment', className: 'bg-amber-600/20 text-amber-300' },
  paid: { label: 'Ready', className: 'bg-blue-600/20 text-blue-300' },
  approved: { label: 'Approved', className: 'bg-green-600/20 text-green-400' },
  rejected: { label: 'Rejected', className: 'bg-red-600/20 text-red-400' },
};
const PAYMENT_LABEL = { razorpay: 'Paid online', qr: 'Paid by QR', offline: 'Paying offline' } as const;

interface RegistrationDetailsModalProps {
  registration: Registration;
  /** Question labels from registrationForms:get. */
  labels: Labels;
  /** Free tournament: hide payment details and call "paid" entries "Waiting". */
  free: boolean;
  categoryName?: string;
  onViewProof: (url: string) => void;
  onClose: () => void;
}

/** A registration shown as a player card, for reviewers on the registrations page. */
export function RegistrationDetailsModal({ registration: r, labels, free, categoryName, onViewProof, onClose }: RegistrationDetailsModalProps) {
  const badge = free && r.status === 'paid' ? { ...STATUS_BADGE.paid, label: 'Waiting' } : STATUS_BADGE[r.status];

  return (
    <PlayerProfileShell profile={r} badge={badge} onClose={onClose}>
      {r.duplicate && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Possible duplicate: same name and phone as another entry or player.
        </p>
      )}

      {r.partner && (
        <div className="bg-slate-800/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-400 mb-3">Couple</h3>
          <CoupleDetails player={r} showPhones />
        </div>
      )}

      <div className="bg-slate-800/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
          <ReceiptText className="w-4 h-4" />
          Registration
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <span className="text-slate-500">Registered</span>
            <p className="font-semibold">{formatSaleTime(r.createdAt)} IST</p>
          </div>
          {!r.partner && r.gender && (
            <div>
              <span className="text-slate-500">Gender</span>
              <p className="font-semibold">{GENDER_LABEL[r.gender]}</p>
            </div>
          )}
          {categoryName && (
            <div>
              <span className="text-slate-500">Category</span>
              <p className="font-semibold">{categoryName}</p>
            </div>
          )}
          <div>
            <span className="text-slate-500">WhatsApp</span>
            <p className="font-semibold">{r.consentWhatsApp ? 'OK to message' : 'No consent'}</p>
          </div>
          {!free && (
            <>
              <div>
                <span className="text-slate-500">Fee</span>
                <p className="font-semibold">{r.fee ? formatRupees(r.fee) : 'Free'}</p>
              </div>
              {r.paymentMethod && (
                <div>
                  <span className="text-slate-500">Payment</span>
                  <p className="font-semibold">{PAYMENT_LABEL[r.paymentMethod]}</p>
                </div>
              )}
              {r.paymentRef && (
                <div className="col-span-2">
                  <span className="text-slate-500">Payment reference</span>
                  <p className="font-semibold break-all">{r.paymentRef}</p>
                </div>
              )}
              {r.paymentProofUrl && (
                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={() => onViewProof(r.paymentProofUrl!)}
                    className="inline-flex items-center gap-1 text-blue-300 underline-offset-2 hover:underline"
                  >
                    <ImageIcon className="h-4 w-4" /> View payment screenshot
                  </button>
                </div>
              )}
            </>
          )}
          {r.rejectReason && (
            <div className="col-span-2">
              <span className="text-slate-500">Reject reason</span>
              <p className="font-semibold text-red-300">{r.rejectReason}</p>
            </div>
          )}
        </div>
      </div>

      {r.answers && r.answers.values.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            Registration answers
          </h3>
          <dl className="space-y-2 text-sm">
            {r.answers.values.map((a) => {
              const q = labels[a.questionId];
              return (
                <div key={a.questionId}>
                  <dt className="text-xs text-slate-400">{q?.label ?? 'Removed question'}{q?.archived ? ' (archived)' : ''}</dt>
                  <dd className="break-words text-slate-100">
                    {q?.type === 'file' && typeof a.value === 'string' ? (
                      <a href={a.value} target="_blank" rel="noopener noreferrer" className="text-blue-300 underline">View image</a>
                    ) : (
                      formatAnswer(a.value, q?.type)
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </PlayerProfileShell>
  );
}
