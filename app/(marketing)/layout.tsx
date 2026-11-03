import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";

// Static, provider-free shell for the marketing pages and /design: no Clerk,
// no Convex, so these pages ship almost no JavaScript.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="dark" className="fl-grain min-h-screen bg-canvas text-ink">
      <a
        href="#main"
        className="fl-focus sr-only z-50 rounded-control bg-signal px-4 py-3 text-signal-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main">{children}</main>
      <MarketingFooter />
    </div>
  );
}
