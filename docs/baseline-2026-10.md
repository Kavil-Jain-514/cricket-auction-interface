# Performance baseline — 2026-10-26

Bid write → viewer update latency at 250 concurrent viewers, measured before any Phase 1 changes
(develop @ `81b4b2d`).

## Setup

| | |
|---|---|
| Deployment | dev (`next-reindeer-102.convex.cloud`) |
| Room | throwaway "Harness Baseline 2026-10" tournament (2 teams, 3 players, ₹10k base, ₹5k increment), room `j97335gw81rxgxhsp6actgb62n8h0akn` |
| Script | `harness/dev-load.mjs` (CLI-identity writer, 250 `getLiveAuction` subscriptions in one process, 6 ladders × 5 bids, 700 ms between bids) |
| Command | `CONVEX_URL=… ROOM_ID=… TEAM_ID=… ADMIN_EMAIL=<dev admin> NUM_VIEWERS=250 node harness/dev-load.mjs` |

**Why not `viewer-load.mjs`:** it needs `CONVEX_ADMIN_KEY` or `ADMIN_JWT`, and neither was available.
`dev-load.mjs` is the README's documented dev path. It measures the same thing (server commit → viewer
receipt, clock-offset corrected) against the same targets.

## Result

```
▶ Dev load run — 250 viewers, 6 ladders
  clock offset: 210ms  | original status: live
  connected: 250/250
  min per-ladder fan-out coverage (worst bid): 22, 195, 250, 83, 250, 250 / 250
BID COMMIT → VIEWER RECEIPT @ 250 viewers  (n=6261 samples)
  min      -123 ms
  p50      604 ms
  p95      12303 ms ✗ (target ≤ 500ms)
  p99      52046 ms ✗ (target ≤ 1200ms)
  max      58347 ms
  (DEV deployment — throttled harder than prod; pessimistic floor.)
```

| metric | target | measured |
|---|---|---|
| p50 | — | 604 ms |
| p95 | < 500 ms | 12,303 ms ✗ |
| p99 | < 1,200 ms | 52,046 ms ✗ |

## Caveat: this run was disturbed

- Viewer sockets dropped **566 times** (`disconnect due to InactiveServer`). **125** query deliveries took
  36.7–57.9 s. Coverage fell to 22/250 and 83/250 in two ladders. The run took about 26 minutes; a clean
  run takes about 3.
- An earlier attempt the same day died in ladder 5. The writer's `npx convex run` failed with
  `TypeError: fetch failed` and the WebSocket clients went into a reconnect loop, so it printed no table.
- Both runs ran from one laptop over a home connection. The p95/p99 tail above is dominated by those
  disconnects, not by Convex fan-out alone. **Treat p50 (604 ms) as the meaningful number from this
  run.** The README's earlier distributed dev measurement (5 × 50 shards) found **p95 ≈ 1.2 s**, which
  is the best clean reference until a stable rerun.
- Already over target either way: p50 alone is above the 500 ms p95 target.

## Rerun

Rerun from a stable connection (wired, or a cloud VM), ideally with the distributed 5 × 50 recipe in
`harness/README.md`, and replace the numbers above. The throwaway tournament is still on dev and can be
reused. If the player is no longer up, start one with `auctions:startNextPlayer`.
