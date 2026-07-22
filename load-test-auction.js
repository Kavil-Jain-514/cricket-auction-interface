// load-test-auction.js
// -----------------------------------------------------------------------------
// Realistic auction load test — targets the CONVEX backend, not the Next server.
//
// WHY: The Next.js pages are `"use client"` shells. Every auction page mounts
// Convex `useQuery` subscriptions and gets its data from Convex over WebSockets.
// The "150+ concurrent viewers" load the code is tuned for lives entirely on the
// Convex read path, NOT on `next start`. So we drive Convex's HTTP query API.
//
// We model the real viewer traffic mix documented in convex/auctions.ts:
//   • HOT  — getLiveAuction:  re-sent to every viewer on each bid / timer tick.
//            This is the dominant, high-frequency load.  (~5x weight)
//   • COLD — getAuctionRoster: re-sent only when a player is sold/unsold or a
//            new player starts.  Much lower frequency.    (~1x weight)
//
// The single-writer path (placeBid) is admin-only — one auctioneer, not a
// mass-concurrency concern — so it is intentionally NOT load tested here.
//
// CAVEATS (read before trusting numbers):
//   1. Hits the DEV deployment by default, which Convex throttles harder than
//      production. Treat results as a conservative (pessimistic) floor.
//   2. Each HTTP query RE-RUNS the function. Real WebSocket subscriptions run
//      the query once and fan the result out to N subscribers, so this
//      OVERSTATES per-viewer DB cost — again, conservative.
//   3. This consumes Convex function calls against your deployment quota.
//
// USAGE:
//   k6 run load-test-auction.js
//   CONVEX_URL=https://<prod>.convex.cloud ROOM_ID=... TOURNAMENT_ID=... \
//     PLAYER_ID=... PEAK_RATE=800 k6 run load-test-auction.js
//
// Get fresh IDs from a live room:
//   npx convex data auctionRooms --limit 5
// -----------------------------------------------------------------------------

import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

// --- Config (override any of these via env) ----------------------------------
const CONVEX_URL = (__ENV.CONVEX_URL || "https://next-reindeer-102.convex.cloud").replace(/\/$/, "");
const ROOM_ID = __ENV.ROOM_ID || "j973312r8tg991jsf3f14gvk41825xjg";
const TOURNAMENT_ID = __ENV.TOURNAMENT_ID || "js78d3442ve5rwps87a3q42wj981rkf5";
const PLAYER_ID = __ENV.PLAYER_ID || "jh78z5rhz7mxc8mb61xqr99dd582sq40"; // currentPlayerId; "" is valid (no player up)

// Ramp shape (req/s). Defaults stay gentle for a throttled DEV deployment.
const START_RATE = Number(__ENV.START_RATE || 50);
const PEAK_RATE = Number(__ENV.PEAK_RATE || 500);

// Ramp stage durations (override for a quick smoke test, e.g. WARMUP=5s RAMP=5s).
const WARMUP = __ENV.WARMUP || "20s";
const RAMP = __ENV.RAMP || "1m";
const HOLD = __ENV.HOLD || "1m";
const RAMPDOWN = __ENV.RAMPDOWN || "20s";

const QUERY_URL = `${CONVEX_URL}/api/query`;

// --- Custom metrics ----------------------------------------------------------
// http_req_failed only catches transport/5xx. A Convex query can return HTTP 200
// with an application-level {"status":"error"}, so we track that separately.
const convexErrors = new Rate("convex_query_errors");
const hotLatency = new Trend("hot_query_latency", true);
const coldLatency = new Trend("cold_query_latency", true);

// --- Scenarios: hot + cold running concurrently, mirroring real traffic -------
export const options = {
  scenarios: {
    hot_getLiveAuction: {
      executor: "ramping-arrival-rate",
      exec: "hotQuery",
      startRate: START_RATE,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 2000,
      stages: [
        { target: START_RATE, duration: WARMUP }, // warm up
        { target: PEAK_RATE, duration: RAMP }, // ramp to peak
        { target: PEAK_RATE, duration: HOLD }, // hold at peak
        { target: 0, duration: RAMPDOWN }, // ramp down
      ],
    },
    cold_getAuctionRoster: {
      executor: "ramping-arrival-rate",
      exec: "coldQuery",
      startRate: Math.max(1, Math.round(START_RATE / 5)),
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { target: Math.max(1, Math.round(START_RATE / 5)), duration: WARMUP },
        { target: Math.round(PEAK_RATE / 5), duration: RAMP },
        { target: Math.round(PEAK_RATE / 5), duration: HOLD },
        { target: 0, duration: RAMPDOWN },
      ],
    },
  },
  thresholds: {
    // Fail the run if the read path degrades past these — tune to your SLO.
    "hot_query_latency": ["p(95)<300", "p(99)<800"],
    "cold_query_latency": ["p(95)<600"],
    "convex_query_errors": ["rate<0.01"], // < 1% application-level errors
    "http_req_failed": ["rate<0.01"], // < 1% transport failures
  },
};

// --- Helpers -----------------------------------------------------------------
function convexQuery(path, args) {
  const res = http.post(QUERY_URL, JSON.stringify({ path, args, format: "json" }), {
    headers: { "Content-Type": "application/json" },
    tags: { convex_fn: path }, // per-function breakdown in the summary
  });

  // A healthy Convex query is HTTP 200 with body {"status":"success", ...}.
  let ok = res.status === 200;
  if (ok) {
    try {
      ok = (res.json("status") === "success");
    } catch (_e) {
      ok = false;
    }
  }
  convexErrors.add(!ok);
  check(res, {
    "http 200": (r) => r.status === 200,
    "status success": () => ok,
  });
  return res;
}

// --- Scenario functions ------------------------------------------------------
export function hotQuery() {
  const res = convexQuery("auctions:getLiveAuction", { auctionRoomId: ROOM_ID });
  hotLatency.add(res.timings.duration);
}

export function coldQuery() {
  const args = { tournamentId: TOURNAMENT_ID };
  if (PLAYER_ID) args.currentPlayerId = PLAYER_ID; // omit when no player is up
  const res = convexQuery("auctions:getAuctionRoster", args);
  coldLatency.add(res.timings.duration);
}
