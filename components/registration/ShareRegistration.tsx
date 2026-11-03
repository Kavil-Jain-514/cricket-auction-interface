"use client";

import { useEffect, useState } from 'react';
import { Copy, Download, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/** The public form's link and a QR to print or share (generated in the browser). */
export function ShareRegistration({ url, tournamentName }: { url: string; tournamentName: string }) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Loaded on demand so the QR encoder stays out of other pages' bundles.
    import('qrcode')
      .then((QRCode) => QRCode.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: 'M' }))
      .then((data) => !cancelled && setQr(data))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <section aria-labelledby="share-form" className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <h2 id="share-form" className="text-lg font-bold">Share the form</h2>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="mx-auto h-40 w-40 shrink-0 rounded-lg bg-white p-2 sm:mx-0">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={`QR code for the ${tournamentName} registration form`} className="h-full w-full" />
          ) : (
            <div className="h-full w-full animate-pulse rounded bg-slate-200 motion-reduce:animate-none" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="break-all rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-300">{url}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success('Link copied'))}>
              <Copy className="h-4 w-4" /> Copy link
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" /> Open
              </a>
            </Button>
            {qr && (
              <Button asChild variant="outline" className="min-h-11">
                <a href={qr} download={`${tournamentName.replace(/[^\w-]+/g, '-')}-registration-qr.png`}>
                  <Download className="h-4 w-4" /> Download QR
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
