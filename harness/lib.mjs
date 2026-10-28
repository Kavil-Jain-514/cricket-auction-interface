// harness/lib.mjs
// Shared helpers for the rehearsal harness (viewer-load + chaos).
//
// Both scripts drive the CONVEX backend directly over real WebSocket
// subscriptions (the same transport the browser uses), so the numbers reflect
// true fan-out to N concurrent viewers — not HTTP query re-execution.
//
// AUTH MODEL
//   • Viewers  — getLiveAuction / getAuctionRoster are PUBLIC queries, so viewer
//                clients need no auth (mirrors real spectators, who are not
//                logged in).
//   • Writer   — placeBid / finalize / restart require an admin. The writer
//                impersonates an admin WITHOUT a Clerk token using
//                setAdminAuth(<deploy key>, { email }); getCurrentUser looks the
//                admin up by identity.email, so ADMIN_EMAIL must be an existing
//                admin user in the target deployment. A Clerk JWT (ADMIN_JWT)
//                is supported as a fallback.

import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";

export const fns = {
  getLiveAuction: anyApi.auctions.getLiveAuction,
  getAuctionRoster: anyApi.auctions.getAuctionRoster,
  placeBid: anyApi.auctions.placeBid,
  finalizePlayerSale: anyApi.auctions.finalizePlayerSale,
  startNextPlayer: anyApi.auctions.startNextPlayer,
  restartCurrentPlayer: anyApi.auctions.restartCurrentPlayer,
  // Owner bidding (owner-load.mjs)
  raiseBid: anyApi.auctions.raiseBid,
  getMyPaddle: anyApi.auctions.getMyPaddle,
  getPendingBidRequests: anyApi.auctions.getPendingBidRequests,
  acceptBidRequest: anyApi.auctions.acceptBidRequest,
};

/** Read + validate the environment shared by both scripts. */
export function readEnv() {
  const env = process.env;
  const url = env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) fail("Set CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) to the target deployment, e.g. https://<name>.convex.cloud");

  const roomId = env.ROOM_ID;
  if (!roomId) fail("Set ROOM_ID — a live auction room with a player currently up. Find it: npx convex data auctionRooms");

  const adminKey = env.CONVEX_ADMIN_KEY || env.CONVEX_DEPLOY_KEY || null;
  const adminEmail = env.ADMIN_EMAIL || null;
  const adminJwt = env.ADMIN_JWT || null;
  if (!adminJwt && !(adminKey && adminEmail)) {
    fail(
      "Writer auth missing. Provide EITHER\n" +
      "  CONVEX_ADMIN_KEY=<deploy key> ADMIN_EMAIL=<an admin user's email>   (preferred, no expiry)\n" +
      "  OR ADMIN_JWT=<convex-template Clerk token>   (from an admin browser: await window.Clerk.session.getToken({template:'convex'}))",
    );
  }

  return {
    url,
    roomId,
    adminKey,
    adminEmail,
    adminJwt,
    numViewers: intEnv("NUM_VIEWERS", 250),
    interBidMs: intEnv("INTER_BID_MS", 200),
    ladders: intEnv("LADDERS", 12),
    bidsPerLadder: intEnv("BIDS_PER_LADDER", 8),
    settleMs: intEnv("SETTLE_MS", 1500),
  };
}

function intEnv(name, dflt) {
  const v = process.env[name];
  if (v === undefined) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

/** A viewer client subscribed to the hot query. Records latest-bid observations. */
export function makeViewer(url, roomId, onLatest) {
  const client = new ConvexClient(url, { unsavedChangesWarning: false });
  const unsub = client.onUpdate(
    fns.getLiveAuction,
    { auctionRoomId: roomId },
    (payload) => {
      if (!payload) return;
      const latest = payload.recentBids?.[0];
      onLatest({
        amount: latest?.amount ?? payload.currentBidAmount ?? null,
        teamId: latest?.teamId ?? payload.currentBidTeamId ?? null,
        currentPlayerId: payload.auctionRoom?.currentPlayerId ?? null,
        totalBidsCount: payload.totalBidsCount ?? 0,
        at: Date.now(),
      });
    },
  );
  return { client, unsub };
}

/** An admin writer client. Resolves once auth is set. */
export function makeWriter(cfg) {
  const client = new ConvexClient(cfg.url, { unsavedChangesWarning: false });
  if (cfg.adminKey && cfg.adminEmail) {
    client.setAdminAuth(cfg.adminKey, {
      subject: "harness-admin",
      issuer: "https://convex.test",
      email: cfg.adminEmail,
    });
  } else {
    client.setAuth(async () => cfg.adminJwt);
  }
  return client;
}

/**
 * A client acting as an existing user, via deploy-key impersonation. Used for
 * team owners, who must already be linked to a team (claimed an invite).
 */
export function makeImpersonatedClient(url, adminKey, email) {
  const client = new ConvexClient(url, { unsavedChangesWarning: false });
  client.setAdminAuth(adminKey, {
    subject: `harness-${email}`,
    issuer: "https://convex.test",
    email,
  });
  return client;
}

/**
 * Discover a safe bidding ladder from live data: pick the team with the most
 * headroom, read the increment and the current bid. Returns null if the room
 * has no player up (nothing to bid on).
 */
export async function discoverBidPlan(writer, roomId) {
  const live = await writer.query(fns.getLiveAuction, { auctionRoomId: roomId });
  if (!live) throw new Error("Auction room not found");
  const room = live.auctionRoom;
  if (room.status !== "live") {
    throw new Error(`Room status is "${room.status}", expected "live". Start the auction first.`);
  }
  if (!room.currentPlayerId) return null;

  const roster = await writer.query(fns.getAuctionRoster, {
    tournamentId: room.tournamentId,
    currentPlayerId: room.currentPlayerId,
  });
  const increment = roster.tournament?.settings?.minBidIncrement ?? 25000;
  const basePrice =
    roster.currentPlayer?.basePrice ?? roster.tournament?.settings?.basePrice ?? 100000;

  // Team with the largest maxAllowedBid gives the most ladder headroom.
  const team = [...(roster.teams ?? [])].sort((a, b) => b.maxAllowedBid - a.maxAllowedBid)[0];
  if (!team) throw new Error("No teams in this tournament");

  const currentBid = live.currentBidAmount ?? basePrice;
  return {
    teamId: team._id,
    increment,
    basePrice,
    ceiling: team.maxAllowedBid,
    currentBid,
    currentPlayerId: room.currentPlayerId,
  };
}

// ── percentile / stats ──────────────────────────────────────────────────────

export function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

export function summarize(samplesMs) {
  const s = [...samplesMs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s[s.length - 1],
  };
}

export function printLatencyTable(title, stats, targets = {}) {
  const row = (label, val, target) => {
    const v = Number.isFinite(val) ? `${Math.round(val)} ms` : "—";
    let mark = "";
    if (target !== undefined && Number.isFinite(val)) mark = val <= target ? " ✓" : ` ✗ (target ≤ ${target}ms)`;
    return `  ${label.padEnd(8)} ${v}${mark}`;
  };
  console.log(`\n${title}  (n=${stats.n} samples)`);
  console.log(row("min", stats.min));
  console.log(row("p50", stats.p50));
  console.log(row("p95", stats.p95, targets.p95));
  console.log(row("p99", stats.p99, targets.p99));
  console.log(row("max", stats.max));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
