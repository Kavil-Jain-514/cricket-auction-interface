// scripts/loadtest/run.mjs
// -----------------------------------------------------------------------------
// Auction-day load + chaos test (AUDIT 2026-10 Phase 4).
//
// Drives a real Convex deployment over WebSockets, the browser's transport:
//   • NUM_VIEWERS viewers with the viewer page's subscriptions (hot
//     getLiveAuction, slim getAuctionRoster, getLatestSaleEvent)
//   • 1 overlay client (hot + full roster + sale event)
//   • NUM_BIDDERS bidders racing on the same price, every bid carrying the
//     expected player and price (the P0-1 guard):
//       - with OWNER_EMAILS: real owner paddles (raiseBid; room in "open" mode)
//       - otherwise: bids for NUM_BIDDERS teams sent through 2 auctioneer
//         consoles (placeBid), alternating, as two consoles would
//   • CHAOS=1: halfway through, every viewer disconnects and reconnects at once
//
// Measures, from one process (one clock):
//   • bid → viewer delivery latency p50/p95/p99 (target p95 < 1000 ms)
//   • bid outcomes: accepted / refused as stale (expected under contention) /
//     refused for another rule / errors (exceptions: these are the failures)
//   • delivered query payloads and their JSON size (bandwidth estimate)
//   • chaos: reconnect time to first fresh payload, and divergence after settle
//
// Writes a JSON report to OUT (default scripts/loadtest/report-<ts>.json).
// Function-call and bandwidth billing: read the Convex dashboard's Usage page
// before and after the run; the script prints the window to compare.
//
// RUN AGAINST A STAGING / REHEARSAL ROOM: it places real bids. RESET=1 clears
// the current player's bids at the end (restartCurrentPlayer).
//
//   CONVEX_URL=https://<staging>.convex.cloud ROOM_ID=<live room, player up> \
//   CONVEX_ADMIN_KEY=<deploy key> ADMIN_EMAIL=<admin email> \
//   NUM_VIEWERS=500 CHAOS=1 RESET=1 node scripts/loadtest/run.mjs
// -----------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import {
  readEnv, makeWriter, makeImpersonatedClient, summarize, printLatencyTable, sleep, fail,
} from "../../harness/lib.mjs";

const api = anyApi.auctions;
const env = process.env;
const int = (name, dflt) => (env[name] === undefined ? dflt : Number(env[name]));

const cfg = {
  ...readEnv(),
  numViewers: int("NUM_VIEWERS", 500),
  numBidders: int("NUM_BIDDERS", 20),
  rounds: int("ROUNDS", 40), // bidding rounds; every bidder tries once per round
  roundGapMs: int("ROUND_GAP_MS", 400),
  rampBatch: int("RAMP_BATCH", 100),
  settleMs: int("SETTLE_MS", 3000),
  chaos: env.CHAOS === "1",
  reset: env.RESET === "1",
  ownerEmails: (env.OWNER_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  out: env.OUT ?? `scripts/loadtest/report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
};

// ── measurement state ───────────────────────────────────────────────────────
const sentAt = new Map(); // accepted amount -> time its mutation was sent
const latency = []; // ms per (viewer, accepted bid) first delivery
const outcomes = { accepted: 0, stale: 0, refused: 0, errors: 0 };
const refusedReasons = new Map();
const errorSamples = [];
const traffic = { updates: 0, bytes: 0 };
const chaosReconnect = [];

const count = (payload) => {
  traffic.updates++;
  traffic.bytes += payload == null ? 4 : JSON.stringify(payload).length;
};

// ── viewers ─────────────────────────────────────────────────────────────────
function makeViewer(url, roomId, { overlay = false } = {}) {
  const client = new ConvexClient(url, { unsavedChangesWarning: false });
  const seen = new Set();
  const viewer = { client, latest: null, firstAt: null, rosterUnsub: null, rosterKey: null };
  const subscribeRoster = (tournamentId, currentPlayerId) => {
    const key = `${tournamentId}:${currentPlayerId ?? ""}`;
    if (key === viewer.rosterKey) return;
    viewer.rosterUnsub?.();
    viewer.rosterKey = key;
    viewer.rosterUnsub = client.onUpdate(
      api.getAuctionRoster,
      { tournamentId, currentPlayerId, ...(overlay ? {} : { includeSoldPlayers: false }) },
      count,
    );
  };
  client.onUpdate(api.getLiveAuction, { auctionRoomId: roomId }, (live) => {
    count(live);
    if (!live) return;
    const now = Date.now();
    viewer.firstAt ??= now;
    viewer.latest = live.currentBidAmount ?? null;
    const t0 = sentAt.get(live.currentBidAmount);
    if (t0 !== undefined && !seen.has(live.currentBidAmount)) {
      seen.add(live.currentBidAmount);
      latency.push(now - t0);
    }
    subscribeRoster(live.auctionRoom.tournamentId, live.auctionRoom.currentPlayerId);
  });
  client.onUpdate(api.getLatestSaleEvent, { auctionRoomId: roomId }, count);
  return viewer;
}

async function connectViewers(n, { ramp }) {
  const viewers = [];
  for (let i = 0; i < n; i++) {
    viewers.push(makeViewer(cfg.url, cfg.roomId));
    if (ramp && (i + 1) % cfg.rampBatch === 0) await sleep(200);
  }
  return viewers;
}

// ── bidders ─────────────────────────────────────────────────────────────────
function record(res, amount, t0) {
  if (res?.success) {
    outcomes.accepted++;
    sentAt.set(res.amount ?? amount, t0);
  } else if (/^(Price changed|Player changed|No player)/.test(res?.reason ?? "")) {
    outcomes.stale++;
  } else {
    outcomes.refused++;
    refusedReasons.set(res?.reason, (refusedReasons.get(res?.reason) ?? 0) + 1);
  }
}

async function attempt(fn) {
  try {
    await fn();
  } catch (err) {
    outcomes.errors++;
    if (errorSamples.length < 20) errorSamples.push(String(err?.message ?? err).slice(0, 200));
  }
}

/** One round: every bidder tries the next price at once, as a real room does. */
async function roundViaConsoles(consoles, teams) {
  const tray = await consoles[0].query(api.getPendingBidRequests, { auctionRoomId: cfg.roomId });
  const live = await consoles[0].query(api.getLiveAuction, { auctionRoomId: cfg.roomId });
  if (!live?.auctionRoom.currentPlayerId || tray.minNextBid == null) return false;
  const expected = { expectedPlayerId: live.auctionRoom.currentPlayerId, expectedCurrentBid: live.currentBidAmount ?? null };
  const amount = tray.minNextBid;
  await Promise.all(
    teams.map((team, i) =>
      attempt(async () => {
        const t0 = Date.now();
        const res = await consoles[i % consoles.length].mutation(api.placeBid, {
          auctionRoomId: cfg.roomId, teamId: team._id, amount, ...expected,
        });
        record(res, amount, t0);
      }),
    ),
  );
  return true;
}

async function roundViaOwners(owners) {
  await Promise.all(
    owners.map((owner) =>
      attempt(async () => {
        const paddle = await owner.query(api.getMyPaddle, { auctionRoomId: cfg.roomId });
        if (!paddle?.currentPlayerId || paddle.minNextBid == null || paddle.isLeading) return;
        const t0 = Date.now();
        const res = await owner.mutation(api.raiseBid, {
          auctionRoomId: cfg.roomId,
          amount: paddle.minNextBid,
          expectedPlayerId: paddle.currentPlayerId,
          expectedCurrentBid: paddle.currentBid,
        });
        record(res, paddle.minNextBid, t0);
      }),
    ),
  );
  return true;
}

// ── chaos ───────────────────────────────────────────────────────────────────
async function chaosAllReconnect(viewers) {
  console.log(`\n⚡ chaos: closing all ${viewers.length} viewers at once, then reconnecting all at once`);
  await Promise.all(viewers.map((v) => v.client.close()));
  const t0 = Date.now();
  const fresh = await connectViewers(viewers.length, { ramp: false });
  const deadline = t0 + 60_000;
  while (fresh.some((v) => v.firstAt === null) && Date.now() < deadline) await sleep(100);
  for (const v of fresh) chaosReconnect.push((v.firstAt ?? deadline) - t0);
  return fresh;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date();
  console.log(`\n▶ Bid11Pro load test  ${startedAt.toISOString()}`);
  console.log(`  target ${cfg.url}  room ${cfg.roomId}`);
  console.log(`  viewers ${cfg.numViewers}  bidders ${cfg.ownerEmails.length || cfg.numBidders} (${cfg.ownerEmails.length ? "owner paddles" : "via 2 consoles"})  chaos ${cfg.chaos}`);

  const consoles = [makeWriter(cfg), makeWriter(cfg)];
  const live = await consoles[0].query(api.getLiveAuction, { auctionRoomId: cfg.roomId });
  if (!live) fail("Room not found");
  if (live.auctionRoom.status !== "live" || !live.auctionRoom.currentPlayerId) {
    fail("The room must be live with a player up. Start one from the console and retry.");
  }
  const roster = await consoles[0].query(api.getAuctionRoster, {
    tournamentId: live.auctionRoom.tournamentId,
    currentPlayerId: live.auctionRoom.currentPlayerId,
  });
  const teams = [...roster.teams].sort((a, b) => b.maxAllowedBid - a.maxAllowedBid).slice(0, cfg.numBidders);
  const owners = cfg.ownerEmails.map((email) => {
    if (!cfg.adminKey) fail("OWNER_EMAILS needs CONVEX_ADMIN_KEY (owners are impersonated)");
    return makeImpersonatedClient(cfg.url, cfg.adminKey, email);
  });

  console.log(`\n… connecting ${cfg.numViewers} viewers (${cfg.rampBatch} every 200 ms) + overlay`);
  let viewers = await connectViewers(cfg.numViewers, { ramp: true });
  const overlay = makeViewer(cfg.url, cfg.roomId, { overlay: true });
  while (viewers.some((v) => v.firstAt === null)) await sleep(200);
  console.log(`  all connected`);
  const trafficBefore = { ...traffic };

  for (let round = 0; round < cfg.rounds; round++) {
    const ok = owners.length ? await roundViaOwners(owners) : await roundViaConsoles(consoles, teams);
    if (!ok) {
      console.log(`  player left the block after ${round} rounds; stopping`);
      break;
    }
    if (cfg.chaos && round === Math.floor(cfg.rounds / 2)) viewers = await chaosAllReconnect(viewers);
    await sleep(cfg.roundGapMs);
  }
  await sleep(cfg.settleMs);

  // Divergence: every viewer must show what the server shows.
  const truth = await consoles[0].query(api.getLiveAuction, { auctionRoomId: cfg.roomId });
  const diverged = [...viewers, overlay].filter((v) => v.latest !== (truth?.currentBidAmount ?? null)).length;

  const lat = summarize(latency);
  printLatencyTable("bid → viewer delivery", lat, { p95: 1000 });
  const attempts = outcomes.accepted + outcomes.stale + outcomes.refused + outcomes.errors;
  console.log(`\nbids: ${attempts} attempts · ${outcomes.accepted} accepted · ${outcomes.stale} refused as stale (expected under contention) · ${outcomes.refused} refused (other) · ${outcomes.errors} errors`);
  console.log(`error rate: ${attempts ? ((outcomes.errors / attempts) * 100).toFixed(2) : 0}%`);
  for (const [reason, n] of refusedReasons) console.log(`  refused ×${n}: ${reason}`);
  for (const e of errorSamples) console.log(`  error: ${e}`);
  const bidPhase = { updates: traffic.updates - trafficBefore.updates, bytes: traffic.bytes - trafficBefore.bytes };
  console.log(`\ndelivered during bidding: ${bidPhase.updates} payloads, ${(bidPhase.bytes / 1e6).toFixed(1)} MB JSON`);
  if (outcomes.accepted) {
    console.log(`  ≈ ${((bidPhase.bytes / outcomes.accepted) / 1e3).toFixed(1)} KB per accepted bid across all clients`);
  }
  let chaos = null;
  if (cfg.chaos) {
    chaos = summarize(chaosReconnect);
    printLatencyTable("chaos: reconnect → first fresh payload", chaos);
  }
  console.log(`\ndivergence after settle: ${diverged} of ${viewers.length + 1} clients ${diverged ? "✗" : "✓"}`);
  console.log(`\nConvex dashboard → Usage: compare function calls and bandwidth for ${startedAt.toISOString()} → ${new Date().toISOString()}`);

  if (cfg.reset) {
    await consoles[0].mutation(api.restartCurrentPlayer, {
      auctionRoomId: cfg.roomId,
      expectedPlayerId: truth?.auctionRoom.currentPlayerId,
    });
    console.log("RESET: cleared the current player's bids");
  }

  writeFileSync(
    cfg.out,
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date(),
        config: { ...cfg, adminKey: undefined, adminJwt: undefined, ownerEmails: cfg.ownerEmails.length },
        latency: lat,
        outcomes,
        refusedReasons: Object.fromEntries(refusedReasons),
        errorSamples,
        traffic: bidPhase,
        chaos,
        diverged,
      },
      null,
      2,
    ),
  );
  console.log(`report: ${cfg.out}`);

  await Promise.all([...viewers, overlay].map((v) => v.client.close()));
  await Promise.all([...consoles, ...owners].map((c) => c.close()));
  process.exit(lat.p95 < 1000 && outcomes.errors === 0 && diverged === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
