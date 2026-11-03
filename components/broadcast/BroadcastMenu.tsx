"use client";

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Radio, Copy, ExternalLink, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { OVERLAY_MODES, overlayUrl, type OverlayMode, type OverlayTheme } from '@/lib/overlayParams';

const MODE_LABELS: Record<OverlayMode, { title: string; hint: string }> = {
  'lower-third': { title: 'Lower third', hint: 'Player, current bid, last 3 bids and timer along the bottom.' },
  full: { title: 'Full screen', hint: 'Hero layout with every team’s purse along the bottom.' },
};

interface BroadcastMenuProps {
  auctionRoomId: string;
}

/** Console button + panel with copyable OBS / vMix Browser Source URLs. */
export function BroadcastMenu({ auctionRoomId }: BroadcastMenuProps) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<OverlayTheme>('dark');
  const [safe, setSafe] = useState(false);

  const urlFor = (mode: OverlayMode) =>
    overlayUrl(window.location.origin, auctionRoomId, { mode, theme, safe });

  const copy = async (mode: OverlayMode) => {
    try {
      await navigator.clipboard.writeText(urlFor(mode));
      toast.success(`${MODE_LABELS[mode].title} URL copied`);
    } catch {
      toast.error('Could not copy — select the URL and copy it manually');
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant="outline"
        size="lg"
        className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300 h-10 sm:h-11 px-2.5 sm:px-4 text-sm touch-target"
        title="Broadcast overlay URLs for OBS / vMix"
      >
        <Radio className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
        <span className="hidden sm:inline">Broadcast</span>
      </Button>

      {/* Portalled to <body>: the console header's backdrop-blur would otherwise
          become the containing block for this fixed overlay and trap it there. */}
      {open && createPortal(
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-60 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="broadcast-title"
            className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-6 my-auto text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id="broadcast-title" className="text-xl font-bold flex items-center gap-2">
                <Radio className="w-5 h-5 text-red-400" /> Broadcast overlay
              </h2>
              <button onClick={() => setOpen(false)} className="p-2 hover:bg-slate-800 rounded-lg transition" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-4 mb-5 text-sm">
              <label className="flex items-center gap-2">
                Theme
                <NativeSelect
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as OverlayTheme)}
                  className="h-8 w-28"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </NativeSelect>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} />
                Title-safe margins
              </label>
            </div>

            <div className="space-y-3 mb-6">
              {OVERLAY_MODES.map((mode) => (
                <div key={mode} className="rounded-lg border border-slate-700 p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="font-semibold">{MODE_LABELS[mode].title}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => copy(mode)}>
                        <Copy className="w-4 h-4" /> Copy URL
                      </Button>
                      <a
                        href={urlFor(mode)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border border-slate-600 hover:bg-slate-800"
                      >
                        <ExternalLink className="w-4 h-4" /> Preview
                      </a>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mb-2">{MODE_LABELS[mode].hint}</p>
                  <input
                    readOnly
                    value={urlFor(mode)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-300"
                    aria-label={`${MODE_LABELS[mode].title} overlay URL`}
                  />
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-slate-800/60 p-4 text-sm text-slate-300">
              <p className="font-semibold text-white mb-2">Add it to OBS</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>OBS → Sources → <b>+</b> → <b>Browser</b>.</li>
                <li>Paste the URL. Set <b>Width 1920</b> and <b>Height 1080</b>.</li>
                <li>Leave “Custom CSS” as is; the background is already transparent.</li>
                <li>Put the source above your camera. No sign-in is needed on the streaming PC.</li>
              </ol>
              <p className="mt-2 text-xs text-slate-400">vMix: Add Input → Web Browser, same URL and size.</p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
