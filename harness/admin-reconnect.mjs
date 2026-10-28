// harness/admin-reconnect.mjs
// -----------------------------------------------------------------------------
// VENUE WI-FI DROP — the admin's socket dies mid-bid and the console retries.
//
// Each round: the admin sends a bid tagged with a fresh requestId, then its
// socket is killed straight away (the mutation may or may not have reached
// the server). After DROP_MS (default 5s) a new admin connection resends the
// SAME requestId, as the console does after a reconnect. Viewers stay
// subscribed throughout.
//
// PASS when, across every round:
//   - duplicates  = 0  — each requestId added exactly one live bid
//   - divergence  = 0  — every viewer's last view equals a fresh authoritative read
//
// USAGE (staging only; it places real bids on the current player):
//   CONVEX_URL=... ROOM_ID=... CONVEX_ADMIN_KEY=... ADMIN_EMAIL=... \
//   [ROUNDS=5] [DROP_MS=5000] [NUM_VIEWERS=20] node harness/admin-reconnect.mjs
// -----------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { readEnv, makeViewer, makeWriter, discoverBidPlan, fns, sleep, fail } from "./lib.mjs";

const cfg = readEnv();
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const DROP_MS = Number(process.env.DROP_MS ?? 5000);
const NUM = Number(process.env.NUM_VIEWERS ?? 20);

const latest = new Map();

const snapKey = (o) =>
  o ? JSON.stringify({ p: o.currentPlayerId ?? null, a: o.amount ?? null, t: o.teamId ?? null, n: o.totalBidsCount ?? 0 }) : "∅";

async function readTruth(writer) {
  const live = await writer.query(fns.getLiveAuction, { auctionRoomId: cfg.roomId });
  return {
    live,
    obs: {
      currentPlayerId: live.auctionRoom?.currentPlayerId ?? null,
      amount: live.recentBids?.[0]?.amount ?? live.currentBidAmount ?? null,
      teamId: live.recentBids?.[0]?.teamId ?? live.currentBidTeamId ?? null,
      totalBidsCount: live.totalBidsCount ?? 0,
    },
  };
}

async function main() {
  console.log(`\n▶ Admin reconnect test  (rounds=${ROUNDS}, drop=${DROP_MS}ms, viewers=${NUM})`);
  let writer = makeWriter(cfg);
  const plan = await discoverBidPlan(writer, cfg.roomId);
  if (!plan) fail("No player is currently up. Start a player and retry.");

  const viewers = [];
  for (let i = 0; i < NUM; i++) {
    viewers.push({ idx: i, ...makeViewer(cfg.url, cfg.roomId, (obs) => latest.set(i, obs)) });
  }
  await sleep(2000);

  let duplicates = 0;
  let currentBid = plan.currentBid;
  for (let round = 1; round <= ROUNDS; round++) {
    const amount = currentBid + plan.increment;
    if (amount > plan.ceiling) { console.log("  (bid ceiling reached; stopping early)"); break; }
    const requestId = randomUUID();
    const before = (await readTruth(writer)).obs.totalBidsCount;
    const args = { auctionRoomId: cfg.roomId, teamId: plan.teamId, amount, requestId };

    // Fire and immediately drop the socket: the bid may or may not land.
    writer.mutation(fns.placeBid, args).catch(() => {});
    await sleep(20);
    await writer.close();
    await sleep(DROP_MS);

    // Reconnect and retry the same action, as the console does.
    writer = makeWriter(cfg);
    const retry = await writer.mutation(fns.placeBid, args);
    const after = (await readTruth(writer)).obs.totalBidsCount;
    const added = after - before;
    if (added !== 1) duplicates += Math.max(0, added - 1);
    console.log(`  round ${round}: ₹${amount} → retry ${retry?.success ? "ok" : `refused (${retry?.reason})`}, live bids +${added}`);
    if (retry?.success) currentBid = amount;
    await sleep(300);
  }

  console.log(`\n  quiescing 3s …`);
  await sleep(3000);
  const authKey = snapKey((await readTruth(writer)).obs);
  const diverged = viewers.filter((v) => snapKey(latest.get(v.idx)) !== authKey);

  console.log(`\n─── ADMIN RECONNECT REPORT ───`);
  console.log(`  authoritative : ${authKey}`);
  console.log(`  duplicates    : ${duplicates} (want 0)`);
  console.log(`  diverged      : ${diverged.length}/${viewers.length} (want 0)`);
  const pass = duplicates === 0 && diverged.length === 0;
  console.log(`\n  ${pass ? "✓ PASS — retries applied once, every viewer converged" : "✗ FAIL — see above"}\n`);

  for (const v of viewers) { try { v.unsub(); await v.client.close(); } catch { /* ignore */ } }
  await writer.close();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
