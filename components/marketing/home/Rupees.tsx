// components/marketing/home/Rupees.tsx - An amount in the display face with
// its ₹ set in the system UI font. ₹ is outside the display face's latin
// subset, so a ₹ in it makes the browser fetch Barlow's latin-ext files after
// layout; that late fetch pushed the home page past its LCP budget. Use this
// for every ₹ amount in font-head text on the home page.
//
// Not `font-sans`: it compiles to var(--font-geist-sans), which is undefined,
// so the span inherits the display face (PriceTicker has the same problem).
// The system stack is what the page's body text renders in today.
export function Rupees({ text }: { text: string }) {
  return (
    <span className="inline-flex items-baseline">
      <span className="mr-[0.06em] self-start font-[family-name:ui-sans-serif,system-ui,sans-serif] text-[0.55em] font-semibold">₹</span>
      {text.replace("₹", "")}
    </span>
  );
}
