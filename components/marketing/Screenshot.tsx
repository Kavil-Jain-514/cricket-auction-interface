// components/marketing/Screenshot.tsx - A real app screenshot in a device
// frame. Files come from scripts/capture-screens.mjs (fictional demo data);
// width/height are fixed so the frame never shifts (CLS). getImageProps
// gives the optimised srcset (AVIF/WebP) with no client JavaScript.
import { getImageProps } from "next/image";

import { SCREENS, type ScreenName } from "@/lib/marketing/screens";
import { cn } from "@/lib/utils";

export function Screenshot({
  name,
  priority = false,
  sizes,
  className,
}: {
  name: ScreenName;
  /** Only for the page's LCP image. */
  priority?: boolean;
  sizes?: string;
  className?: string;
}) {
  const s = SCREENS[name];
  const phone = s.width < 600;
  const { props: img } = getImageProps({
    src: s.src,
    alt: s.alt,
    width: s.width,
    height: s.height,
    priority,
    sizes: sizes ?? (phone ? "300px" : "(min-width: 1280px) 1200px, 100vw"),
  });
  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      <div
        className={cn(
          "overflow-hidden border border-line bg-surface shadow-floating",
          phone ? "mx-auto w-full max-w-[300px] rounded-[2rem] border-[6px] border-raised" : "rounded-card",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- props come from getImageProps */}
        <img {...img} alt={s.alt} className="h-auto w-full" />
      </div>
      <figcaption className="text-center text-sm text-ink-muted">{s.caption}</figcaption>
    </figure>
  );
}
