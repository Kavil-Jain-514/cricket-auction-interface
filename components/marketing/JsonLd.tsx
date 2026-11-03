// components/marketing/JsonLd.tsx - Renders schema.org data built in lib/seo/jsonld.ts.
import { serializeJsonLd } from "@/lib/seo/jsonld";

export function JsonLd({ data }: { data: Parameters<typeof serializeJsonLd>[0] }) {
  return (
    <script
      type="application/ld+json"
      // serializeJsonLd escapes "<", so this can't break out of the tag.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
