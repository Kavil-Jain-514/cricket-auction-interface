// harness/dev-load.mjs
// Full 250-viewer load run against the DEV room using the CLI-identity writer
// (no deploy key needed). Latency = offset-corrected server-commit → viewer
// receipt. Restores the room to its original status on exit.
// DEV is throttled harder than prod — treat numbers as a pessimistic floor.

import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { summarize, printLatencyTable, sleep } from "./lib.mjs";

const execFileP = promisify(execFile);
const URL = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const ROOM = process.env.ROOM_ID;
const TEAM = process.env.TEAM_ID;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
if (!URL || !ROOM || !TEAM || !ADMIN_EMAIL) {
  console.error("Set CONVEX_URL, ROOM_ID, TEAM_ID, ADMIN_EMAIL");
  process.exit(1);
}
const IDENTITY = JSON.stringify({ email: ADMIN_EMAIL });
const PROD = process.env.CONVEX_TARGET === "prod"; // pass --prod to the CLI writer
const NUM_VIEWERS = Number(process.env.NUM_VIEWERS ?? 250);
const LADDER = (process.env.LADDER ?? "10000,15000,20000,25000,30000").split(",").map(Number);
const NUM_LADDERS = Number(process.env.LADDERS ?? 6);

async function runAdmin(fn, argsObj) {
  const args = [
    "convex", "run", `auctions:${fn}`, JSON.stringify(argsObj),
    "--identity", IDENTITY, "--typecheck", "disable", "--codegen", "disable",
  ];
  if (PROD) args.push("--prod");
  const { stdout } = await execFileP("npx", args, { cwd: process.cwd() });
  return stdout.trim();
}

const samples = []; // latency ms

async function main() {
  console.log(`\n▶ Dev load run — ${NUM_VIEWERS} viewers, ${NUM_LADDERS} ladders\n`);
  const probe = new ConvexClient(URL, { unsavedChangesWarning: false });
  const live0 = await probe.query(anyApi.auctions.getLiveAuction, { auctionRoomId: ROOM });
  const offset = Date.now() - live0.serverTime;
  const originalStatus = live0.auctionRoom.status;
  await probe.close();
  console.log(`  clock offset: ${offset}ms  | original status: ${originalStatus}`);

  // A fresh per-ladder scoreboard prevents cross-ladder amount collisions.
  let scored = LADDER.map(() => new Set());
  const viewers = [];
  let firstSnaps = 0;
  for (let i = 0; i < NUM_VIEWERS; i++) {
    const client = new ConvexClient(URL, { unsavedChangesWarning: false });
    let gotFirst = false;
    client.onUpdate(anyApi.auctions.getLiveAuction, { auctionRoomId: ROOM }, (p) => {
      if (!p) return;
      if (!gotFirst) { gotFirst = true; firstSnaps++; }
      const bid = p.recentBids?.[0];
      if (!bid) return;
      const li = LADDER.indexOf(bid.amount);
      if (li === -1 || scored[li].has(i)) return;
      scored[li].add(i);
      samples.push((Date.now() - offset) - bid.timestamp);
    });
    viewers.push(client);
  }
  const dl = Date.now() + 30000;
  while (firstSnaps < NUM_VIEWERS && Date.now() < dl) await sleep(150);
  console.log(`  connected: ${firstSnaps}/${NUM_VIEWERS}\n`);

  const coverage = [];
  try {
    await runAdmin("resumeAuction", { auctionRoomId: ROOM });
    for (let ladder = 0; ladder < NUM_LADDERS; ladder++) {
      scored = LADDER.map(() => new Set());
      await runAdmin("restartCurrentPlayer", { auctionRoomId: ROOM });
      await sleep(500);
      for (const amount of LADDER) {
        const res = await runAdmin("placeBid", { auctionRoomId: ROOM, teamId: TEAM, amount });
        if (!res.includes("success: true") && !res.includes('"success": true')) {
          console.warn(`  bid ${amount} rejected: ${res.replace(/\s+/g, " ").slice(0, 70)}`);
        }
        await sleep(700);
      }
      await sleep(600);
      coverage.push(scored.map((s) => s.size).reduce((a, b) => Math.min(a, b), NUM_VIEWERS));
      process.stdout.write(`\r  ladder ${ladder + 1}/${NUM_LADDERS} — ${samples.length} samples   `);
    }
    await sleep(1500);
  } finally {
    console.log("\n  cleanup: clearing bids + restoring status …");
    try { await runAdmin("restartCurrentPlayer", { auctionRoomId: ROOM }); } catch { /* ignore */ }
    if (originalStatus === "paused") { try { await runAdmin("pauseAuction", { auctionRoomId: ROOM }); } catch { /* ignore */ } }
  }

  console.log(`\n  min per-ladder fan-out coverage (worst bid): ${coverage.join(", ")} / ${NUM_VIEWERS}`);
  printLatencyTable(`BID COMMIT → VIEWER RECEIPT @ ${NUM_VIEWERS} viewers`, summarize(samples), { p95: 500, p99: 1200 });
  console.log(`\n  (DEV deployment — throttled harder than prod; pessimistic floor.)\n`);

  for (const c of viewers) { try { await c.close(); } catch { /* ignore */ } }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
