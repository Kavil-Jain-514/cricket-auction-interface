import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { optimizeImageUrl } from '@/lib/utils';

type Sponsor = { name: string; logoUrl?: string };

/** Cloudinary widths for 1x / 2x / 3x screens; other hosts are used as-is. */
function logoSrcSet(url: string): string | undefined {
  if (!url.includes('res.cloudinary.com')) return undefined;
  return [240, 480, 720].map((w) => `${optimizeImageUrl(url, w)} ${w}w`).join(', ');
}

/** Up to two initials, for a sponsor whose logo is missing or broken. */
function monogram(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

/**
 * Sponsors on the public registration form, large: each sponsor's name sits
 * above its tile (one line, the full name in the tooltip), and tiles are 96px
 * tall on phones and 144px from sm up, logos contained (never stretched) on a
 * light tile so dark and transparent logos both read. Phones get one
 * swipeable row so the form stays near the top; wider screens get a wrapping
 * grid. A missing or broken logo shows the sponsor's initials. Names are
 * required on save (convex/validation.ts normalizeSponsors); a blank one just
 * has no caption.
 */
export function SponsorBand({ sponsors }: { sponsors: Sponsor[] }) {
  if (sponsors.length === 0) return null;
  return (
    <section aria-labelledby="sponsors-title" className="border-t border-white/10 bg-black/20 px-4 py-4 sm:px-5">
      <h2 id="sponsors-title" className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-slate-400 sm:text-left">
        Supported by
      </h2>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] sm:overflow-visible sm:px-0">
        {sponsors.map((s, i) => {
          const name = s.name.trim();
          return (
            <li key={`${i}-${name}`} className="w-40 shrink-0 snap-start sm:w-auto">
              {name && (
                <p title={name} className="mb-1.5 truncate px-1 text-center text-xs font-semibold text-slate-200 sm:text-sm">
                  {name}
                </p>
              )}
              <div className="flex h-24 items-center justify-center rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5 sm:h-36 sm:p-4">
                <ImgWithFallback
                  src={s.logoUrl ? optimizeImageUrl(s.logoUrl, 480) : undefined}
                  srcSet={s.logoUrl ? logoSrcSet(s.logoUrl) : undefined}
                  sizes="(min-width: 640px) 13rem, 10rem"
                  alt={name ? `${name} logo` : 'Sponsor logo'}
                  // The first row is near the top of the page; the rest load as they scroll in.
                  loading={i < 4 ? 'eager' : 'lazy'}
                  className="h-full w-full object-contain"
                  fallback={<span aria-hidden className="font-head text-3xl font-bold text-slate-400 sm:text-4xl">{monogram(name)}</span>}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
