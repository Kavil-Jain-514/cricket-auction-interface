// components/ds/price-ticker.tsx - The bid amount, rolling digit by digit.
// Pure CSS: each digit is a 0–9 column moved with a transform transition, so
// it needs no client JS and no framer-motion. Columns are keyed from the
// right, so the units digit stays the units digit as the number grows.
// Tabular numerals keep the width fixed; reduced motion zeroes --dur-slow.
import { cn, formatCurrency } from "@/lib/utils"

const DIGITS = "0123456789"

function DigitColumn({ digit }: { digit: number }) {
  return (
    <span className="relative inline-block h-[1em] overflow-hidden" aria-hidden>
      <span
        className="flex flex-col transition-transform duration-(--dur-slow) ease-floodlight"
        style={{ transform: `translateY(-${digit}em)` }}
      >
        {[...DIGITS].map((d) => (
          <span key={d} className="block h-[1em] leading-none">
            {d}
          </span>
        ))}
      </span>
    </span>
  )
}

export function PriceTicker({
  amount,
  format = formatCurrency,
  className,
}: {
  amount: number
  /** Defaults to the app's lakh format (₹1.50L). */
  format?: (amount: number) => string
  className?: string
}) {
  const text = format(amount)
  const chars = [...text]

  return (
    <span
      role="img"
      aria-label={text}
      className={cn("inline-flex items-baseline font-head font-bold leading-none tabular", className)}
    >
      {chars.map((ch, i) => {
        const key = chars.length - i // position from the right
        if (DIGITS.includes(ch)) return <DigitColumn key={key} digit={Number(ch)} />
        // ₹ comes from the UI face (the display face has no rupee glyph).
        if (ch === "₹")
          return (
            <span key={key} aria-hidden className="mr-[0.06em] self-start font-sans text-[0.55em] font-semibold">
              ₹
            </span>
          )
        return (
          <span key={key} aria-hidden className="leading-none">
            {ch}
          </span>
        )
      })}
    </span>
  )
}
