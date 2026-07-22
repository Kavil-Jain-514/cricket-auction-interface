// harness/dev-viewers.mjs
// Viewer-only shard: connect NUM_VIEWERS, measure offset-corrected
// server-commit → receipt latency for ladder-amount bids over a fixed window,
// print this shard's percentiles. No writer. Used to run 250 connections split
// across several processes (each its own event loop) to separate real server
// fan-out latency from single-process callback-queue contention.

import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import { summarize, sleep } from "./lib.mjs";

const URL = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const ROOM = process.env.ROOM_ID;
if (!URL || !ROOM) { console.error("Set CONVEX_URL and ROOM_ID"); process.exit(1); }
const SHARD = process.env.SHARD ?? "?";
const NUM = Number(process.env.NUM_VIEWERS ?? 50);
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 70000);
const LADDER = new Set((process.env.LADDER ?? "10000,15000,20000,25000,30000").split(",").map(Number));

const samples = [];

const probe = new ConvexClient(URL, { unsavedChangesWarning: false });
const live0 = await probe.query(anyApi.auctions.getLiveAuction, { auctionRoomId: ROOM });
const offset = Date.now() - live0.serverTime;
await probe.close();

const seen = new Map(); // viewerIdx -> Set of (amount+timestamp) keys already scored
const viewers = [];
let connected = 0;
for (let i = 0; i < NUM; i++) {
  const client = new ConvexClient(URL, { unsavedChangesWarning: false });
  seen.set(i, new Set());
  let first = false;
  client.onUpdate(anyApi.auctions.getLiveAuction, { auctionRoomId: ROOM }, (p) => {
    if (!p) return;
    if (!first) { first = true; connected++; }
    const bid = p.recentBids?.[0];
    if (!bid || !LADDER.has(bid.amount)) return;
    const key = `${bid.amount}:${bid.timestamp}`;
    const s = seen.get(i);
    if (s.has(key)) return;
    s.add(key);
    samples.push((Date.now() - offset) - bid.timestamp);
  });
  viewers.push(client);
}

await sleep(WINDOW_MS);
const st = summarize(samples);
console.log(`SHARD ${SHARD}: connected=${connected}/${NUM} n=${st.n} p50=${Math.round(st.p50)}ms p95=${Math.round(st.p95)}ms p99=${Math.round(st.p99)}ms max=${Math.round(st.max)}ms`);
for (const c of viewers) { try { await c.close(); } catch { /* ignore */ } }
process.exit(0);
