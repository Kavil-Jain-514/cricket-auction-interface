"use client";

import { useCallback, useEffect, useState } from 'react';
import { Gavel } from 'lucide-react';
import { hotkeyBelongsToSomethingElse } from '@/lib/keyboard';

interface GoingOnceHelperProps {
  /** Shown only when the advisory timer has hit zero on a live player. */
  visible: boolean;
  hasBids: boolean;
  /** Changes whenever the stage must reset (new bid, new player, timer reset). */
  resetKey: string;
  onFinalize: () => void;
}

/**
 * Console helper at timer zero: "Going once → Going twice → Sold". Each tap
 * or each press of S advances one step, so one stray key can't sell anyone.
 * The final step calls the same finalise as the Sold button.
 */
export function GoingOnceHelper(props: GoingOnceHelperProps) {
  if (!props.visible) return null;
  // Remount per resetKey so the stage always starts at "Going once".
  return <GoingOnceSteps key={props.resetKey} {...props} />;
}

function GoingOnceSteps({ hasBids, onFinalize }: GoingOnceHelperProps) {
  const [stage, setStage] = useState(0);
  const labels = ['Going once…', 'Going twice…', hasBids ? 'Sold!' : 'Unsold!'];

  const step = useCallback(() => {
    if (stage === 2) onFinalize();
    else setStage(stage + 1);
  }, [stage, onFinalize]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 's' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (hotkeyBelongsToSomethingElse(e)) return;
      e.preventDefault();
      step();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  return (
    <div className="mt-4 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 sm:p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm font-semibold text-amber-200">Time&apos;s up — call it</p>
        <span className="text-[11px] text-amber-200/70">Tap or press S</span>
      </div>
      <div className="flex gap-1.5 mb-3" aria-hidden="true">
        {labels.map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < stage ? 'bg-amber-400' : 'bg-slate-700'}`} />
        ))}
      </div>
      <button
        type="button"
        onClick={step}
        className={`w-full min-h-12 inline-flex items-center justify-center gap-2 rounded-lg text-lg font-extrabold transition-colors ${stage === 2
          ? hasBids ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'
          : 'bg-amber-500 hover:bg-amber-400 text-amber-950'}`}
      >
        <Gavel className="w-5 h-5" />
        {labels[stage]}
      </button>
    </div>
  );
}
