// app/auction/[roomId]/overlay/page.tsx
"use client";

import { use } from 'react';
import { BroadcastOverlay } from '@/components/broadcast/BroadcastOverlay';
import { parseOverlayParams } from '@/lib/overlayParams';

interface OverlayPageProps {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Public broadcast overlay: add as an OBS / vMix Browser Source at 1920x1080.
 * ?mode=lower-third|full&theme=dark|light&safe=1
 */
export default function OverlayPage({ params, searchParams }: OverlayPageProps) {
  const { roomId } = use(params);
  const overlay = parseOverlayParams(use(searchParams));
  return <BroadcastOverlay roomId={roomId} {...overlay} />;
}
