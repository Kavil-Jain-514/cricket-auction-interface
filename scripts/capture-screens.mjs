// scripts/capture-screens.mjs - Real screenshots with Playwright (system Chrome).
//
// Marketing shots (public/marketing/*.png, sizes in lib/marketing/screens.ts).
// Use a demo tournament with FICTIONAL names and no real photos: these images
// are published on the marketing site.
//   BASE_URL=http://localhost:3000 ROOM_ID=<live room> RESULTS_ID=<completed tournament> \
//   REGISTER_ID=<tournament with registration open> node scripts/capture-screens.mjs marketing
//
// App screens at 390x844 and 1920x1080, to compare a branch with develop:
//   BASE_URL=... ROOM_ID=... TOURNAMENT_ID=... OUT=/tmp/shots-develop \
//   node scripts/capture-screens.mjs app
// Signed-in pages need a session: set STORAGE_STATE to a Playwright storage
// state file saved after signing in (npx playwright codegen --save-storage).
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const mode = process.argv[2];
const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
};
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1920, height: 1080 };

function marketingShots() {
  const room = env("ROOM_ID");
  return [
    { file: "projector.png", path: `/auction/${room}`, viewport: DESKTOP },
    { file: "viewer-phone.png", path: `/auction/${room}`, viewport: PHONE },
    // The overlay is transparent; it is composited over a stand-in for a camera feed.
    { file: "overlay.png", path: `/auction/${room}/overlay?mode=full`, viewport: DESKTOP, backdrop: true },
    { file: "results.png", path: `/results/${env("RESULTS_ID")}`, viewport: DESKTOP },
    { file: "registration-phone.png", path: `/register/${env("REGISTER_ID")}`, viewport: PHONE },
  ];
}

function appShots() {
  const room = env("ROOM_ID");
  const tournament = env("TOURNAMENT_ID");
  const pages = {
    dashboard: "/dashboard",
    "tournament-hub": `/tournament/${tournament}`,
    "auction-room": `/auction/${room}`,
  };
  return Object.entries(pages).flatMap(([name, path]) => [
    { file: `${name}-390x844.png`, path, viewport: PHONE },
    { file: `${name}-1920x1080.png`, path, viewport: DESKTOP },
  ]);
}

async function main() {
  if (mode !== "marketing" && mode !== "app") {
    throw new Error("Usage: node scripts/capture-screens.mjs marketing|app");
  }
  const shots = mode === "marketing" ? marketingShots() : appShots();
  const out = mode === "marketing" ? "public/marketing" : env("OUT");
  await mkdir(out, { recursive: true });

  const browser = await chromium.launch({ channel: "chrome" });
  try {
    for (const shot of shots) {
      const context = await browser.newContext({
        viewport: shot.viewport,
        deviceScaleFactor: 1,
        reducedMotion: "reduce", // settle animations so shots are repeatable
        storageState: process.env.STORAGE_STATE,
      });
      const page = await context.newPage();
      await page.goto(new URL(shot.path, BASE_URL).toString(), { waitUntil: "networkidle" });
      // Live data and images settle; the auction page's new-player intro lasts 2 s.
      await page.waitForTimeout(4000);
      if (shot.backdrop) {
        const overlay = await page.screenshot({ omitBackground: true });
        await page.setContent(
          `<body style="margin:0;background:repeating-linear-gradient(90deg,#1f4d33 0 120px,#1a4430 120px 240px)">` +
            `<img style="display:block" src="data:image/png;base64,${overlay.toString("base64")}"></body>`,
        );
      }
      await page.screenshot({ path: join(out, shot.file) });
      console.log(`saved ${join(out, shot.file)}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
