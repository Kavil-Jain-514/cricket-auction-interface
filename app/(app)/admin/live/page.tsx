"use client";

// Super-admin live-ops panel (AUDIT 2026-10 Phase 5): running rooms and who
// has a console or owner paddle open, recent client errors, the Razorpay
// webhook log, the WhatsApp queue and refunds due. Viewer counts are not
// tracked per client (D2); use the Convex dashboard for those.

import { useQuery } from 'convex/react';
import { AlertTriangle, MessageCircle, Radio, Receipt, Wallet } from 'lucide-react';
import { api } from '@/convex/_generated/api';

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Card({ title, icon: Icon, children }: { title: string; icon: typeof Radio; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Icon className="h-4 w-4 text-slate-400" /> {title}
      </h2>
      {children}
    </section>
  );
}

export default function AdminLivePage() {
  const data = useQuery(api.ops.liveOverview);
  if (data === undefined) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`Running auctions (${data.rooms.length})`} icon={Radio}>
        {data.rooms.length === 0 && <p className="text-sm text-slate-500">No auction is live or paused.</p>}
        <ul className="space-y-3">
          {data.rooms.map((room) => (
            <li key={room._id} className="rounded-lg border border-slate-800 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{room.tournamentName}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${room.status === 'live' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                  {room.status}
                </span>
                {room.rehearsal && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-xs text-sky-300">rehearsal</span>}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {room.currentPlayer ? `On the block: ${room.currentPlayer}` : 'No player up'} · last activity {time(room.lastActivity)}
              </p>
              <p className="mt-2 text-xs text-slate-300">
                {room.online.length === 0
                  ? 'No console or owner paddle connected'
                  : room.online.map((p) => `${p.email} (${p.role}, ${p.secondsAgo}s)`).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="WhatsApp queue" icon={MessageCircle}>
        <p className="text-sm">
          {data.whatsapp.queued} queued · {data.whatsapp.sending} sending ·{' '}
          <span className={data.whatsapp.failed ? 'text-red-400' : ''}>{data.whatsapp.failed} failed</span>
        </p>
        {data.whatsapp.lastError && <p className="mt-1 break-all text-xs text-slate-400">Last failure: {data.whatsapp.lastError}</p>}
      </Card>

      <Card title="Recent client errors" icon={AlertTriangle}>
        {data.recentErrors.length === 0 && <p className="text-sm text-slate-500">None.</p>}
        <ul className="space-y-2 text-xs">
          {data.recentErrors.map((e) => (
            <li key={e._id}>
              <span className="text-slate-400">{time(e.at)}</span> <span className="font-mono">{e.fn}</span> · {e.email}
              <div className="break-all text-red-300">{e.message}</div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Razorpay webhooks" icon={Receipt}>
        {data.webhooks.length === 0 && <p className="text-sm text-slate-500">None received yet.</p>}
        <ul className="space-y-1 text-xs">
          {data.webhooks.map((w) => (
            <li key={w._id}>
              <span className="text-slate-400">{time(w.receivedAt)}</span> {w.event} {w.orderId && <span className="font-mono">{w.orderId}</span>} ·{' '}
              <span className={w.outcome === 'applied' ? 'text-emerald-300' : 'text-amber-300'}>{w.outcome}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Refunds due" icon={Wallet}>
        <p className="text-sm">
          {data.refundsDue.plans} plan payment{data.refundsDue.plans === 1 ? '' : 's'} · {data.refundsDue.registrations} registration fee
          {data.refundsDue.registrations === 1 ? '' : 's'}
        </p>
        <p className="mt-1 text-xs text-slate-400">Payments that arrived but could not be applied. Refund them in the Razorpay dashboard.</p>
      </Card>
    </div>
  );
}
