// lib/overlayParams.ts
// Query params for the OBS/vMix broadcast overlay:
//   /auction/<roomId>/overlay?mode=lower-third|full&theme=dark|light&safe=1

export type OverlayMode = 'lower-third' | 'full';
export type OverlayTheme = 'dark' | 'light';

export interface OverlayParams {
  mode: OverlayMode;
  theme: OverlayTheme;
  /** Inset content into the broadcast title-safe area. */
  safe: boolean;
}

export const OVERLAY_MODES: OverlayMode[] = ['lower-third', 'full'];

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Unknown or missing values fall back to lower-third, dark, no safe margins. */
export function parseOverlayParams(params: RawParams): OverlayParams {
  const mode = first(params.mode);
  const theme = first(params.theme);
  return {
    mode: mode === 'full' ? 'full' : 'lower-third',
    theme: theme === 'light' ? 'light' : 'dark',
    safe: first(params.safe) === '1',
  };
}

export function overlayUrl(origin: string, roomId: string, params: OverlayParams): string {
  const query = new URLSearchParams({
    mode: params.mode,
    theme: params.theme,
    ...(params.safe ? { safe: '1' } : {}),
  });
  return `${origin}/auction/${roomId}/overlay?${query.toString()}`;
}
