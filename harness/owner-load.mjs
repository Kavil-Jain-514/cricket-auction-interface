// harness/owner-load.mjs
// -----------------------------------------------------------------------------
// OWNER LOAD TEST — 12 owners raising from their paddles while 250 viewers watch.
//
// Opens NUM_VIEWERS real Convex WebSocket subscriptions to the hot
// getLiveAuction query, plus one client per owner subscribed to getMyPaddle.
// Owners then raise in a loop (each waits OWNER_RAISE_MS ± jitter, skips while
// leading or over their max) for DURATION_S seconds. Behaviour follows the
// tournament's bidMode:
//
//   open    — raises go straight to liveBids. Measures raise → viewer update.
//   confirm — raises queue as bidRequests. An admin client watches the tray
//             (getPendingBidRequests) and accepts the highlighted raise after
//             AUTO_ACCEPT_MS. Measures raise → tray, and accept → viewer update.
//
// When every owner is out of headroom the admin restarts the current player's
// bids (like viewer-load.mjs) — this DELETES the current player's live bids.
//
// PREREQUISITES (against STAGING):
//   • tournament bidMode set to "open" or "confirm" (settings modal)
//   • a live room with a player up
//   • OWNER_EMAILS: owners already linked to teams (each claimed an invite)
//
// USAGE:
//   CONVEX_URL=https://<staging>.convex.cloud ROOM_ID=<room id> \
//   CONVEX_ADMIN_KEY=<deploy key> ADMIN_EMAIL=<admin email> \
//   OWNER_EMAILS=o1@x.com,o2@x.com,... node harness/owner-load.mjs
//
// Tunables (env): NUM_VIEWERS (250), DURATION_S (60), OWNER_RAISE_MS (600),
//                 AUTO_ACCEPT_MS (300), SETTLE_MS (1500)
// -----------------------------------------------------------------------------

import {
  readEnv, makeViewer, makeWriter, makeImpersonatedClient, fns,
  summarize, printLatencyTable, sleep, fail,
} from "./lib.mjs";

const cfg = readEnv();
const ownerEmails = (process.env.OWNER_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
if (!cfg.adminKey) fail("owner-load needs CONVEX_ADMIN_KEY: owners are impersonated with the deploy key.");
if (ownerEmails.length === 0) fail("Set OWNER_EMAILS to a comma-separated list of owner emails (users who claimed an invite).");

const num = (name, dflt) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== undefined ? n : dflt;
};
const durationMs = num("DURATION_S", 60) * 1000;
const raiseEveryMs = num("OWNER_RAISE_MS", 600);
const autoAcceptMs = num("AUTO_ACCEPT_MS", 300);

// amount → time the first write that could produce it was issued.
// Open mode: the owner's raise; confirm mode: the admin's accept.
let issueTimes = new Map();
const fanoutSamples = [];     // write → each viewer sees the amount
const raiseAckSamples = [];   // owner raiseBid round-trip
const trayLatencySamples = []; // confirm: raise issued → request appears in tray
const outcomes = new Map();   // result reason → count

const count = (key) => outcomes.set(key, (outcomes.get(key) ?? 0) + 1);

function makeViewerRecorder() {
  const seen = new Set();
  return (obs) => {
    if (obs.amount == null || seen.has(obs.amount)) return;
    const t0 = issueTimes.get(obs.amount);
    if (t0 === undefined) return;
    seen.add(obs.amount);
    fanoutSamples.push(obs.at - t0);
  };
}

async function main() {
  console.log(`\n▶ Owner load test`);
  console.log(`  target : ${cfg.url}`);
  console.log(`  room   : ${cfg.roomId}`);
  console.log(`  owners : ${ownerEmails.length}   viewers: ${cfg.numViewers}`);

  const admin = makeWriter(cfg);

  // ── owners ──────────────────────────────────────────────────────────────
  const owners = ownerEmails.map((email) => ({
    email,
    client: makeImpersonatedClient(cfg.url, cfg.adminKey, email),
    paddle: undefined,
    busy: false,
  }));
  for (const o of owners) {
    o.unsub = o.client.onUpdate(fns.getMyPaddle, { auctionRoomId: cfg.roomId }, (p) => { o.paddle = p; });
  }
  const paddleDeadline = Date.now() + 15_000;
  while (owners.some((o) => o.paddle === undefined) && Date.now() < paddleDeadline) await sleep(100);
  const notOwners = owners.filter((o) => !o.paddle).map((o) => o.email);
  if (notOwners.length) fail(`These users are not owners in this room's tournament: ${notOwners.join(", ")}`);
  const bidMode = owners[0].paddle.bidMode;
  if (bidMode === "admin_only") fail('Tournament bidMode is "admin_only". Switch it to "open" or "confirm" in the settings modal.');
  console.log(`  mode   : ${bidMode}`);
  if (!owners[0].paddle.currentPlayerId) fail("No player is currently up in this room.");

  // ── viewers ─────────────────────────────────────────────────────────────
  process.stdout.write(`  connecting ${cfg.numViewers} viewers … `);
  let firstSnapshots = 0;
  const viewers = [];
  for (let i = 0; i < cfg.numViewers; i++) {
    const recorder = makeViewerRecorder();
    let gotFirst = false;
    viewers.push(makeViewer(cfg.url, cfg.roomId, (obs) => {
      if (!gotFirst) { gotFirst = true; firstSnapshots++; }
      recorder(obs);
    }));
  }
  const deadline = Date.now() + 30_000;
  while (firstSnapshots < cfg.numViewers && Date.now() < deadline) await sleep(100);
  console.log(`${firstSnapshots}/${cfg.numViewers} connected\n`);

  // ── confirm mode: admin tray + auto-accept ───────────────────────────────
  const raiseIssuedAt = new Map(); // requestId → raise issue time
  const trayFirstSeen = new Set();
  let acceptTimer = null;
  let unsubTray = () => {};
  if (bidMode === "confirm") {
    unsubTray = admin.onUpdate(fns.getPendingBidRequests, { auctionRoomId: cfg.roomId }, (tray) => {
      const now = Date.now();
      for (const r of tray.requests) {
        if (trayFirstSeen.has(r._id)) continue;
        trayFirstSeen.add(r._id);
        const t0 = raiseIssuedAt.get(r._id);
        if (t0 !== undefined) trayLatencySamples.push(now - t0);
      }
      const best = tray.requests.find((r) => tray.minNextBid !== null && r.amount >= tray.minNextBid);
      if (!best || acceptTimer) return;
      acceptTimer = setTimeout(async () => {
        acceptTimer = null;
        if (!issueTimes.has(best.amount)) issueTimes.set(best.amount, Date.now());
        const res = await admin.mutation(fns.acceptBidRequest, { requestId: best._id }).catch((e) => ({ success: false, reason: e.message }));
        count(res.success ? "accept: ok" : `accept: ${res.reason}`);
      }, autoAcceptMs);
    });
  }

  // ── owners raise ────────────────────────────────────────────────────────
  const stopAt = Date.now() + durationMs;
  let restarts = 0;

  async function ownerLoop(o) {
    while (Date.now() < stopAt) {
      await sleep(raiseEveryMs * (0.5 + Math.random()));
      const p = o.paddle;
      if (!p || p.isLeading || p.minNextBid === null || o.busy) continue;
      if (p.minNextBid > p.maxAllowedBid || p.myPending) continue;
      const amount = p.minNextBid;
      o.busy = true;
      const t0 = Date.now();
      if (bidMode === "open" && !issueTimes.has(amount)) issueTimes.set(amount, t0);
      try {
        const res = await o.client.mutation(fns.raiseBid, { auctionRoomId: cfg.roomId, amount });
        raiseAckSamples.push(Date.now() - t0);
        count(res.success ? (res.pending ? "raise: queued" : "raise: accepted") : `raise: ${res.reason}`);
        if (res.pending) raiseIssuedAt.set(res.requestId, t0);
      } catch (e) {
        count(`raise threw: ${e.message}`);
      } finally {
        o.busy = false;
      }
    }
  }

  // Reset the ladder when nobody can raise any more.
  async function headroomWatch() {
    while (Date.now() < stopAt) {
      await sleep(1000);
      const anyCanRaise = owners.some((o) => o.paddle && o.paddle.minNextBid !== null && o.paddle.minNextBid <= o.paddle.maxAllowedBid);
      if (!anyCanRaise) {
        await admin.mutation(fns.restartCurrentPlayer, { auctionRoomId: cfg.roomId });
        issueTimes = new Map();
        restarts++;
      }
      process.stdout.write(`\r  ${Math.max(0, Math.round((stopAt - Date.now()) / 1000))}s left — ${fanoutSamples.length} fan-out samples, ${restarts} restarts   `);
    }
  }

  await Promise.all([...owners.map(ownerLoop), headroomWatch()]);
  await sleep(cfg.settleMs);
  console.log("\n");

  printLatencyTable("Owner raise ack (mutation round-trip)", summarize(raiseAckSamples));
  if (bidMode === "confirm") {
    printLatencyTable("RAISE → AUCTIONEER TRAY", summarize(trayLatencySamples), { p95: 500, p99: 1200 });
  }
  printLatencyTable(
    bidMode === "open" ? "OWNER RAISE → VIEWER UPDATE (fan-out)" : "ACCEPT → VIEWER UPDATE (fan-out)",
    summarize(fanoutSamples),
    { p95: 500, p99: 1200 },
  );

  console.log(`\n  Outcomes:`);
  for (const [k, n] of [...outcomes].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(6)}  ${k}`);
  console.log(`\n  Contention rejections ("Minimum bid is …", "Please wait …") are expected: owners race for the same price.`);
  console.log(`  Acceptance targets: p95 < 500ms, p99 < 1200ms (${cfg.numViewers} viewers + ${owners.length} owners)\n`);

  unsubTray();
  if (acceptTimer) clearTimeout(acceptTimer);
  for (const o of owners) { try { o.unsub(); await o.client.close(); } catch { /* ignore */ } }
  for (const v of viewers) { try { v.unsub(); await v.client.close(); } catch { /* ignore */ } }
  await admin.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
