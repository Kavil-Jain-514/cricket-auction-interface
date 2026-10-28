// components/marketing/PageIntro.tsx - Breadcrumbs (visible and as
// BreadcrumbList JSON-LD), the page's single H1 and its lead paragraph.
import Link from "next/link";

import { JsonLd } from "@/components/marketing/JsonLd";
import { breadcrumbJsonLd } from "@/lib/seo/jsonld";

export function PageIntro({
  path,
  crumb,
  title,
  lead,
}: {
  path: string;
  crumb: string;
  title: string;
  lead: string;
}) {
  return (
    <div className="fl-turf border-b border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 pt-10 pb-14 sm:px-6 sm:pt-14">
        <JsonLd data={breadcrumbJsonLd([{ name: crumb, path }])} />
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-2 text-sm text-ink-muted">
            <li>
              <Link href="/" className="fl-focus rounded hover:text-ink">
                Home
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-ink">
              {crumb}
            </li>
          </ol>
        </nav>
        <h1 className="max-w-4xl font-head text-5xl leading-[0.95] font-bold tracking-wide uppercase sm:text-6xl lg:text-7xl">
          {title}
        </h1>
        <p className="max-w-2xl text-lg text-ink-muted sm:text-xl">{lead}</p>
      </div>
    </div>
  );
}
