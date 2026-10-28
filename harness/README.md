# Rehearsal harness

Proves the auction holds at 250 concurrent viewers before the live event. Both
scripts drive the **Convex backend over real WebSocket subscriptions** — the same
transport the browser uses — so latencies reflect true fan-out, not HTTP polling.

> Supersedes the older root-level `load-test*.js` (k6/HTTP), which measured query
> re-execution and, by its own note, *overstated* per-viewer cost. Prefer these.

## Prerequisites

1. A **staging** (or production, off-hours) Convex deployment.
2. A **live auction room with a player currently up** (status `live`, a
   `currentPlayerId` set, at least one team with purse headroom). Start one from
   the admin UI, or it will tell you what's missing.
3. Writer auth — pick one:
   - **Preferred (no expiry):** a Convex **deploy key** + an existing admin email.
     Deploy key: Convex dashboard → Settings → Deploy Keys.
   - **Fallback:** a Convex-template Clerk JWT from an admin browser console:
     `await window.Clerk.session.getToken({ template: 'convex' })` (expires ~60s).

## Environment

| var | required | meaning |
|---|---|---|
| `CONVEX_URL` | ✓ | `https://<name>.convex.cloud` (or falls back to `NEXT_PUBLIC_CONVEX_URL`) |
| `ROOM_ID` | ✓ | live auction room id (`npx convex data auctionRooms`) |
| `CONVEX_ADMIN_KEY` + `ADMIN_EMAIL` | ✓* | writer auth via admin impersonation (preferred) |
| `ADMIN_JWT` | ✓* | writer auth via Clerk token (alternative to the above) |
| `NUM_VIEWERS` | | default 250 (load) / 30 (chaos) |
| `INTER_BID_MS` | | pacing between bids, default 200 |
| `LADDERS`, `BIDS_PER_LADDER` | | load-test volume, default 12 × 8 |
| `CHAOS_ADVANCE=1` | | chaos: also finalize+advance players (**DESTRUCTIVE**) |

\* provide either the admin-key pair **or** `ADMIN_JWT`.

## Run

```bash
# Load test — bid write → viewer update latency at 250 clients
CONVEX_URL=https://<staging>.convex.cloud \
ROOM_ID=<room id> \
CONVEX_ADMIN_KEY=<deploy key> ADMIN_EMAIL=<admin email> \
node harness/viewer-load.mjs

# Chaos test — convergence + no duplicate bids under kill/restore + dup bids
CONVEX_URL=... ROOM_ID=... CONVEX_ADMIN_KEY=... ADMIN_EMAIL=... \
NUM_VIEWERS=30 node harness/chaos.mjs
```

## Acceptance targets (from the brief)

| metric | target | which script |
|---|---|---|
| bid write → update, p95, 250 clients | < 500 ms | `viewer-load.mjs` |
| bid write → update, p99 | < 1200 ms | `viewer-load.mjs` |
| client divergence after chaos | 0 | `chaos.mjs` |
| duplicate bid acceptance | 0 | `chaos.mjs` |
| retried bid after a 5s admin socket drop | applied once, 0 divergence | `admin-reconnect.mjs` |

## Owner bidding load (owner-load.mjs)

12 team owners raising from their paddles while 250 viewers watch. Owners are
impersonated with the deploy key, so `CONVEX_ADMIN_KEY` is required (a Clerk
JWT cannot stand in for 12 different people).

Before running:

1. Set the tournament's **Who can bid** to `open` or `confirm` (settings modal).
2. Link each owner to a team: create an invite from the team card and open the
   `/join/<token>` link signed in as that owner.
3. Start a player.

```bash
CONVEX_URL=https://<staging>.convex.cloud ROOM_ID=<room id> \
CONVEX_ADMIN_KEY=<deploy key> ADMIN_EMAIL=<admin email> \
OWNER_EMAILS=owner1@x.com,owner2@x.com,...,owner12@x.com \
node harness/owner-load.mjs
```

| var | default | meaning |
|---|---|---|
| `OWNER_EMAILS` | required | comma-separated owner emails |
| `DURATION_S` | 60 | how long owners keep raising |
| `OWNER_RAISE_MS` | 600 | mean gap between one owner's raises (±50% jitter) |
| `AUTO_ACCEPT_MS` | 300 | confirm mode: delay before the admin client accepts the highlighted raise |

What it reports:

- **open:** owner raise → viewer update (fan-out).
- **confirm:** raise → auctioneer tray, then accept → viewer update.
- Both modes: raise round-trip, plus a count of every outcome. Contention
  rejections such as `Minimum bid is …` are expected, because owners race for
  the same price.

When no owner has headroom left, the script restarts the current player's bids,
the same way `viewer-load.mjs` does. **This deletes the live bids of the player
on the block.**

## Distributed / high-N measurement (dev-load.mjs, dev-viewers.mjs)

Measuring 250 subscribers **in one process** is fine for correctness, but on the
dev deployment we found fan-out latency at 250 concurrent viewers (p95 ≈ 1.2s)
that is **real server-side latency**, not a single-event-loop artifact — proven
by splitting 250 connections across 5 processes and seeing identical numbers
per shard. Use these two env-driven scripts to reproduce / run against prod:

- `dev-load.mjs` — CLI-identity writer (no deploy key; acts as `ADMIN_EMAIL` via
  `npx convex run --identity`). Set `CONVEX_TARGET=prod` to target production.
  Env: `CONVEX_URL ROOM_ID TEAM_ID ADMIN_EMAIL [NUM_VIEWERS LADDERS LADDER]`.
- `dev-viewers.mjs` — viewer-only shard (no writer); prints its own percentiles.
  Env: `CONVEX_URL ROOM_ID SHARD NUM_VIEWERS WINDOW_MS [LADDER]`.

Distributed run (250 = 5×50, each its own event loop) while one writer drives bids:
```bash
for s in 1 2 3 4 5; do SHARD=$s NUM_VIEWERS=50 WINDOW_MS=95000 \
  CONVEX_URL=... ROOM_ID=... node harness/dev-viewers.mjs & done
sleep 14
NUM_VIEWERS=0 LADDERS=5 CONVEX_URL=... ROOM_ID=... TEAM_ID=... ADMIN_EMAIL=... \
  node harness/dev-load.mjs
wait
```

## Notes & caveats

- **One process, one clock.** All viewers run in a single Node process, so
  latency samples have no cross-machine clock skew.
- **"Update" ≈ render.** We measure when a viewer's subscription callback fires
  (the network + Convex fan-out). Browser paint adds a few ms on top.
- **Coalescing.** Convex may collapse rapid updates and deliver only the latest,
  so some intermediate bid amounts won't be sampled by every viewer — the samples
  that *are* recorded are still valid end-to-end measurements. Keep `INTER_BID_MS`
  ≥ ~150 for good coverage.
- **Per-IP WebSocket limits.** 250 sockets from one machine may hit a provider
  per-IP cap; the load script reports how many viewers connected. If short,
  run from a couple of machines and sum, or ask Convex about limits.
- **Quota cost.** These runs consume Convex function calls against the target
  deployment. Relevant to AUDIT **P0-2** — run once, read the dashboard usage.
- **Chaos is stateful.** Without `CHAOS_ADVANCE` it only bids + restarts (leaves
  the player up). With it, players are consumed — run against a throwaway
  tournament and `restartAuction` afterward.
```

## Admin reconnect (admin-reconnect.mjs)

Venue Wi-Fi drop on the **console**: each round sends a bid with a `requestId`,
kills the admin socket immediately, waits `DROP_MS` (default 5000), reconnects
and resends the same `requestId`. Passes when every round adds exactly one live
bid and every viewer converges. Places real bids on the current player, so run
it on staging.

```bash
CONVEX_URL=... ROOM_ID=... CONVEX_ADMIN_KEY=... ADMIN_EMAIL=... \
ROUNDS=5 DROP_MS=5000 node harness/admin-reconnect.mjs
```
