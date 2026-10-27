// components/marketing/Logo.tsx - The Bid11Pro wordmark: a floodlit ball
// (seam in the signal accent) and the name in the display face.
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <circle cx="16" cy="16" r="14" fill="#d22f2f" />
        <path d="M6 16q5-7 10 0t10 0" fill="none" stroke="var(--fl-signal)" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 16q5 7 10 0t10 0" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span className="font-head text-2xl font-bold tracking-wide uppercase">
        Bid<span className="text-signal">11</span>Pro
      </span>
    </span>
  );
}
