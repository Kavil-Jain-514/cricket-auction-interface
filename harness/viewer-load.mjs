// harness/viewer-load.mjs
// -----------------------------------------------------------------------------
// LOAD TEST — "bid write → client update" latency at N concurrent viewers.
//
// Opens NUM_VIEWERS (default 250) real Convex WebSocket subscriptions to the hot
// getLiveAuction query, then a single admin writer places escalating bids. For
// every bid, we measure the delta between the moment the write is issued and the
// moment each viewer's subscription delivers that bid — i.e. the network +
// fan-out component of "bid write → render" (browser paint adds a few ms on top).
//
// All viewers run in ONE Node process, so there is no cross-machine clock skew:
// every timestamp comes from the same monotonic clock.
//
// USAGE (against STAGING):
//   CONVEX_URL=https://<staging>.convex.cloud \
//   ROOM_ID=<live room id with a player up> \
//   CONVEX_ADMIN_KEY=<deploy key> ADMIN_EMAIL=<admin email> \
//   node harness/viewer-load.mjs
//
// Tunables (env): NUM_VIEWERS, INTER_BID_MS, LADDERS, BIDS_PER_LADDER, SETTLE_MS
// -----------------------------------------------------------------------------

import {
  readEnv, makeViewer, makeWriter, discoverBidPlan, fns,
  summarize, printLatencyTable, sleep, fail,
} from "./lib.mjs";

const cfg = readEnv();

// Per-run correlation: writeTimes maps a (unique-within-ladder) amount -> issue
// time. Viewers report the first time they observe each amount.
let writeTimes = new Map();
const fanoutSamples = [];   // ms, one per (viewer, observed bid)
const writeAckSamples = []; // ms, writer's own mutation round-trip

// Each viewer remembers which amounts it has already scored so a repeated
// delivery of the same value isn't counted twice.
function makeViewerRecorder() {
  const seen = new Set();
  return (obs) => {
    if (obs.amount == null) return;
    const t0 = writeTimes.get(obs.amount);
    if (t0 === undefined || seen.has(obs.amount)) return;
    seen.add(obs.amount);
    fanoutSamples.push(obs.at - t0);
  };
}

async function main() {
  console.log(`\n▶ Viewer load test`);
  console.log(`  target : ${cfg.url}`);
  console.log(`  room   : ${cfg.roomId}`);
  console.log(`  viewers: ${cfg.numViewers}`);

  const writer = makeWriter(cfg);

  const plan = await discoverBidPlan(writer, cfg.roomId);
  if (!plan) fail("No player is currently up in this room. Start a player (admin: Start / next) and retry.");
  console.log(`  team   : ${plan.teamId}  (headroom ≤ ${plan.ceiling})`);
  console.log(`  incr   : ${plan.increment}   base: ${plan.basePrice}\n`);

  // Spin up viewers and wait for their first snapshot so all sockets are warm
  // before any bid is issued (otherwise early bids see fewer subscribers).
  process.stdout.write(`  connecting ${cfg.numViewers} viewers … `);
  let firstSnapshots = 0;
  const viewers = [];
  for (let i = 0; i < cfg.numViewers; i++) {
    const recorder = makeViewerRecorder();
    let gotFirst = false;
    const v = makeViewer(cfg.url, cfg.roomId, (obs) => {
      if (!gotFirst) { gotFirst = true; firstSnapshots++; }
      recorder(obs);
    });
    viewers.push(v);
  }
  // Wait (up to 30s) for all viewers to receive their initial value.
  const deadline = Date.now() + 30_000;
  while (firstSnapshots < cfg.numViewers && Date.now() < deadline) await sleep(100);
  console.log(`${firstSnapshots}/${cfg.numViewers} connected`);
  if (firstSnapshots < cfg.numViewers) {
    console.warn(`  ⚠ ${cfg.numViewers - firstSnapshots} viewers never got a first snapshot (per-IP WS limit?). Continuing.`);
  }

  // Run ladders: escalate bids under the ceiling, then restart to reset and go
  // again. Amounts are unique within a ladder for clean correlation.
  let currentBid = plan.currentBid;
  for (let ladder = 0; ladder < cfg.ladders; ladder++) {
    writeTimes = new Map(); // only the current ladder's amounts are "live"
    for (let b = 0; b < cfg.bidsPerLadder; b++) {
      const amount = currentBid + plan.increment;
      if (amount > plan.ceiling) break; // out of headroom → restart ladder
      const t0 = Date.now();
      writeTimes.set(amount, t0);
      const res = await writer.mutation(fns.placeBid, {
        auctionRoomId: cfg.roomId, teamId: plan.teamId, amount,
      });
      writeAckSamples.push(Date.now() - t0);
      if (res?.success) {
        currentBid = amount;
      } else {
        // Unexpected rejection (purse/increment/timer). Log once and reset ladder.
        console.warn(`  bid ${amount} rejected: ${res?.reason ?? "unknown"} — restarting ladder`);
        break;
      }
      await sleep(cfg.interBidMs);
    }
    // Reset bids for the next ladder (keeps amounts bounded, player stays up).
    await writer.mutation(fns.restartCurrentPlayer, { auctionRoomId: cfg.roomId });
    currentBid = plan.currentBid;
    await sleep(300);
    process.stdout.write(`\r  ladder ${ladder + 1}/${cfg.ladders} done — ${fanoutSamples.length} fan-out samples   `);
  }

  // Let the last in-flight fan-outs land.
  await sleep(cfg.settleMs);
  console.log("\n");

  printLatencyTable("Writer ack (mutation round-trip)", summarize(writeAckSamples));
  printLatencyTable("BID WRITE → VIEWER UPDATE (fan-out)", summarize(fanoutSamples), { p95: 500, p99: 1200 });

  console.log(`\n  Acceptance targets: p95 < 500ms, p99 < 1200ms (${cfg.numViewers} clients)`);
  console.log(`  NOTE: fan-out latency = network + Convex fan-out. Browser paint adds a few ms.\n`);

  for (const v of viewers) { try { v.unsub(); await v.client.close(); } catch { /* ignore */ } }
  await writer.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
