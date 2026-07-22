// harness/chaos.mjs
// -----------------------------------------------------------------------------
// CHAOS TEST — prove every client converges to identical state under stress.
//
// Runs three overlapping stressors against a live room while a pool of viewers
// is subscribed, then asserts convergence:
//   1. DUPLICATE BIDS   — fire the same (team, amount) twice back-to-back and two
//                         teams at the same amount. Convex serialization must
//                         accept at most one bid per price level (strict
//                         increment). Duplicate acceptances → FAIL.
//   2. CONNECTION CHAOS — repeatedly close a random viewer's socket and
//                         immediately recreate + resubscribe it, mid-bidding.
//                         After reconnect it must resync to the true state.
//   3. RAPID ADVANCE    — (opt-in, DESTRUCTIVE) finalize + start next player in a
//                         tight loop. Enable with CHAOS_ADVANCE=1. Consumes
//                         players; run only against a throwaway staging
//                         tournament, then restartAuction to reset.
//
// CONVERGENCE: after the stressors stop and the system quiesces, every viewer's
// last snapshot (currentPlayerId, latest amount, latest team, totalBidsCount)
// must be byte-identical to each other AND to a fresh authoritative read.
//
// USAGE:
//   CONVEX_URL=... ROOM_ID=... CONVEX_ADMIN_KEY=... ADMIN_EMAIL=... \
//   NUM_VIEWERS=30 [CHAOS_ADVANCE=1] node harness/chaos.mjs
// -----------------------------------------------------------------------------

import {
  readEnv, makeViewer, makeWriter, discoverBidPlan, fns, sleep, fail,
} from "./lib.mjs";

const cfg = readEnv();
const NUM = Number(process.env.NUM_VIEWERS ?? 30); // fewer than load test by default
const ADVANCE = process.env.CHAOS_ADVANCE === "1";
const DURATION_MS = Number(process.env.CHAOS_DURATION_MS ?? 20_000);

// Latest snapshot per viewer, keyed by a stable index that survives reconnects.
const latest = new Map(); // idx -> obs
let duplicateAcceptances = 0;

function spawnViewer(idx) {
  const v = makeViewer(cfg.url, cfg.roomId, (obs) => latest.set(idx, obs));
  return v;
}

function snapKey(o) {
  if (!o) return "∅";
  return JSON.stringify({
    p: o.currentPlayerId ?? null,
    a: o.amount ?? null,
    t: o.teamId ?? null,
    n: o.totalBidsCount ?? 0,
  });
}

async function main() {
  console.log(`\n▶ Chaos test  (viewers=${NUM}, advance=${ADVANCE}, ~${DURATION_MS / 1000}s)`);
  const writer = makeWriter(cfg);
  const plan = await discoverBidPlan(writer, cfg.roomId);
  if (!plan) fail("No player is currently up. Start a player and retry.");

  let viewers = [];
  for (let i = 0; i < NUM; i++) viewers.push({ idx: i, ...spawnViewer(i) });
  await sleep(2000); // warm up sockets

  // discoverBidPlan gives the highest-headroom team; we also need a second team
  // for same-amount collision bids, so re-read the roster here.
  const roster = await writer.query(fns.getAuctionRoster, {
    tournamentId: (await writer.query(fns.getLiveAuction, { auctionRoomId: cfg.roomId })).auctionRoom.tournamentId,
    currentPlayerId: plan.currentPlayerId,
  });
  const teams = [...(roster.teams ?? [])].sort((a, b) => b.maxAllowedBid - a.maxAllowedBid);
  const teamA = teams[0]?._id, teamB = teams[1]?._id ?? teams[0]?._id;

  let currentBid = plan.currentBid;
  const stop = Date.now() + DURATION_MS;
  let tick = 0;

  while (Date.now() < stop) {
    tick++;
    const amount = currentBid + plan.increment;
    if (amount > plan.ceiling) {
      await writer.mutation(fns.restartCurrentPlayer, { auctionRoomId: cfg.roomId });
      currentBid = plan.currentBid;
      await sleep(150);
      continue;
    }

    // (1) Duplicate bids: same amount fired 3x concurrently across two teams.
    const results = await Promise.all([
      writer.mutation(fns.placeBid, { auctionRoomId: cfg.roomId, teamId: teamA, amount }),
      writer.mutation(fns.placeBid, { auctionRoomId: cfg.roomId, teamId: teamA, amount }),
      writer.mutation(fns.placeBid, { auctionRoomId: cfg.roomId, teamId: teamB, amount }),
    ]);
    const accepted = results.filter((r) => r?.success).length;
    if (accepted > 1) {
      duplicateAcceptances += accepted - 1;
      console.warn(`  ⚠ ${accepted} bids accepted at the SAME amount ${amount} (expected ≤1)`);
    }
    if (accepted >= 1) currentBid = amount;

    // (2) Connection chaos: kill + respawn a random viewer every few ticks.
    if (tick % 3 === 0 && viewers.length > 0) {
      const victim = viewers[Math.floor(Math.random() * viewers.length)];
      try { victim.unsub(); await victim.client.close(); } catch { /* ignore */ }
      const fresh = { idx: victim.idx, ...spawnViewer(victim.idx) };
      viewers = viewers.map((v) => (v.idx === victim.idx ? fresh : v));
    }

    // (3) Rapid advance (opt-in, destructive).
    if (ADVANCE && tick % 10 === 0) {
      await writer.mutation(fns.finalizePlayerSale, { auctionRoomId: cfg.roomId });
      const next = await writer.mutation(fns.startNextPlayer, { auctionRoomId: cfg.roomId });
      if (next?.completed) { console.log("  (auction completed during advance)"); break; }
      const np = await discoverBidPlan(writer, cfg.roomId);
      if (np) { plan.currentPlayerId = np.currentPlayerId; plan.ceiling = np.ceiling; currentBid = np.currentBid; }
    }

    await sleep(120);
  }

  // ── Quiesce, then assert convergence ──────────────────────────────────────
  console.log(`\n  stressors stopped after ${tick} ticks — quiescing 3s …`);
  await sleep(3000);

  const authoritative = await writer.query(fns.getLiveAuction, { auctionRoomId: cfg.roomId });
  const authObs = {
    currentPlayerId: authoritative.auctionRoom?.currentPlayerId ?? null,
    amount: authoritative.recentBids?.[0]?.amount ?? authoritative.currentBidAmount ?? null,
    teamId: authoritative.recentBids?.[0]?.teamId ?? authoritative.currentBidTeamId ?? null,
    totalBidsCount: authoritative.totalBidsCount ?? 0,
  };
  const authKey = snapKey(authObs);

  const keys = new Map();
  for (const v of viewers) keys.set(v.idx, snapKey(latest.get(v.idx)));
  const distinct = new Set(keys.values());
  const diverged = [...keys.entries()].filter(([, k]) => k !== authKey);

  console.log(`\n─── CONVERGENCE REPORT ───`);
  console.log(`  authoritative : ${authKey}`);
  console.log(`  viewers       : ${viewers.length}`);
  console.log(`  distinct views: ${distinct.size} (want 1)`);
  console.log(`  diverged      : ${diverged.length} (want 0)`);
  console.log(`  dup acceptance: ${duplicateAcceptances} (want 0)`);

  const pass = distinct.size <= 1 && diverged.length === 0 && duplicateAcceptances === 0;
  console.log(`\n  ${pass ? "✓ PASS — all clients converged, no duplicate bids accepted" : "✗ FAIL — see above"}\n`);
  if (!pass) {
    for (const [idx, k] of diverged.slice(0, 10)) console.log(`    viewer#${idx}: ${k}`);
  }

  for (const v of viewers) { try { v.unsub(); await v.client.close(); } catch { /* ignore */ } }
  await writer.close();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
