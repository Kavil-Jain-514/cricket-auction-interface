// harness/smoke.mjs
// -----------------------------------------------------------------------------
// SMOKE TEST — validates the harness end-to-end against real infra with a small,
// low-risk footprint. Authorized one-off against the DEV room; restores the room
// to `paused` when done.
//
// Writer auth: uses `npx convex run --identity` (acts as the admin by email) so
// no deploy key is needed. Latency is measured from the bid's SERVER commit
// timestamp to each viewer's receipt, offset-corrected for local↔server clock
// skew — independent of how the write was triggered.
// -----------------------------------------------------------------------------

import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { summarize, printLatencyTable, sleep } from "./lib.mjs";

const execFileP = promisify(execFile);

const URL = "https://next-reindeer-102.convex.cloud";
const ROOM = "j97c4hmabc16pmcsdbtq3j4vwn8b0f0f";
const TEAM = "jn70wpp2geghgtj8rxard8ktps8aptkz"; // Tripology Holidays (top headroom)
const IDENTITY = '{"email":"kjain.freelance@gmail.com"}';
const NUM_VIEWERS = 10;
const LADDER = [10000, 15000, 20000, 25000, 30000]; // base 10k, +5k, ceiling 30k

async function runAdmin(fn, argsObj) {
  const args = [
    "convex", "run", `auctions:${fn}`, JSON.stringify(argsObj),
    "--identity", IDENTITY, "--typecheck", "disable", "--codegen", "disable",
  ];
  const { stdout } = await execFileP("npx", args, { cwd: process.cwd() });
  return stdout.trim();
}

const observations = []; // { amount, latencyMs }

async function main() {
  console.log(`\n▶ Smoke test (dev room, ${NUM_VIEWERS} viewers)\n`);

  // 1. Clock offset: local - server.
  const probe = new ConvexClient(URL, { unsavedChangesWarning: false });
  const live0 = await probe.query(anyApi.auctions.getLiveAuction, { auctionRoomId: ROOM });
  const offset = Date.now() - live0.serverTime;
  const originalStatus = live0.auctionRoom.status;
  console.log(`  clock offset (local-server): ${offset} ms`);
  console.log(`  original room status       : ${originalStatus}`);
  await probe.close();

  // 2. Viewers. Each records the first receipt of each ladder amount, with the
  //    bid's server timestamp for offset-corrected latency.
  const scored = LADDER.map(() => new Set()); // per-amount set of viewer idxs
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
      const correctedReceipt = Date.now() - offset;
      observations.push({ amount: bid.amount, latencyMs: correctedReceipt - bid.timestamp });
    });
    viewers.push(client);
  }
  const dl = Date.now() + 15000;
  while (firstSnaps < NUM_VIEWERS && Date.now() < dl) await sleep(100);
  console.log(`  viewers connected          : ${firstSnaps}/${NUM_VIEWERS}\n`);

  try {
    // 3. Make the room live with a fresh timer + clean slate.
    console.log("  resuming room + resetting current player …");
    await runAdmin("resumeAuction", { auctionRoomId: ROOM });
    await runAdmin("restartCurrentPlayer", { auctionRoomId: ROOM });
    await sleep(800);

    // 4. Place the ladder. Async exec keeps the event loop free so viewer
    //    callbacks fire in real time while the CLI subprocess runs.
    for (const amount of LADDER) {
      const res = await runAdmin("placeBid", { auctionRoomId: ROOM, teamId: TEAM, amount });
      const ok = res.includes('"success": true') || res.includes("success: true");
      process.stdout.write(`  bid ${String(amount).padStart(6)} → ${ok ? "accepted" : "REJECTED: " + res.replace(/\s+/g, " ").slice(0, 80)}\n`);
      await sleep(900); // > 500ms per-team rate limit, lets fan-out land
    }
    await sleep(1500); // final settle
  } finally {
    // 5. Cleanup: clear bids, restore original status.
    console.log("\n  cleaning up (clear bids, restore status) …");
    try { await runAdmin("restartCurrentPlayer", { auctionRoomId: ROOM }); } catch (e) { console.warn("  restart cleanup failed:", e.message); }
    if (originalStatus === "paused") {
      try { await runAdmin("pauseAuction", { auctionRoomId: ROOM }); } catch (e) { console.warn("  re-pause failed:", e.message); }
    }
  }

  // 6. Report.
  const coverage = LADDER.map((amt, i) => `${amt}:${scored[i].size}/${NUM_VIEWERS}`).join("  ");
  console.log(`\n  fan-out coverage (viewers that saw each bid):\n    ${coverage}`);
  printLatencyTable("BID COMMIT → VIEWER RECEIPT (offset-corrected)", summarize(observations.map((o) => o.latencyMs)), { p95: 500, p99: 1200 });
  console.log("\n  ✓ Smoke test complete. (Dev is throttled harder than prod — treat latency as a pessimistic floor.)\n");

  for (const c of viewers) { try { await c.close(); } catch { /* ignore */ } }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
