// lib/marketing/screens.ts - The marketing screenshots. Captured by
// scripts/capture-screens.mjs from a demo tournament with fictional names;
// the sizes here must match the PNGs in public/marketing/.

export const SCREENS = {
  projector: {
    src: "/marketing/projector.png",
    width: 1920,
    height: 1080,
    alt: "Bid11Pro projector view: the player on the block, the current bid and the leading team",
    caption: "Projector view on the venue screen",
  },
  viewerPhone: {
    src: "/marketing/viewer-phone.png",
    width: 390,
    height: 844,
    alt: "Bid11Pro live auction on a phone",
    caption: "The live auction on a phone",
  },
  overlay: {
    src: "/marketing/overlay.png",
    width: 1920,
    height: 1080,
    alt: "Bid11Pro broadcast overlay over a video feed",
    caption: "Broadcast overlay in OBS",
  },
  results: {
    src: "/marketing/results.png",
    width: 1920,
    height: 1080,
    alt: "Bid11Pro public results page with squads and top buys",
    caption: "Public results page",
  },
  registrationPhone: {
    src: "/marketing/registration-phone.png",
    width: 390,
    height: 844,
    alt: "Bid11Pro player registration form on a phone",
    caption: "Player registration form",
  },
} as const;

export type ScreenName = keyof typeof SCREENS;
